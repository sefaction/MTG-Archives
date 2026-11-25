import { Prisma, TradeStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { huntAdjustmentsInput, locationIsBulk } from "./pull-scope";
import { buildLocationPathMap } from "./inventory-locations";
import { handoffHash, handoffStamp } from "./card-handoff-policy";
import { parseDecklistText } from "./deck-import";
import { isBasicLandCard } from "./card-types";
import { planCommittedDeckPrintings } from "./deck-committed-printings";
import { isSystemDeckLocation } from "./deck-inventory";
import { buildReservedInventoryQuantities } from "./trade-lines";
import {
  isPullableHuntStock,
  planCardHunt,
  type HuntRequest,
  type HuntStock,
} from "./card-hunt";

const sourceId = z.string().trim().min(1).max(100);
const sourceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("DECK"), id: sourceId, deckId: sourceId })
    .strict(),
  z
    .object({
      kind: z.literal("LIST"),
      id: sourceId,
      label: z.string().trim().min(1).max(100),
      text: z.string().trim().min(1).max(100_000),
    })
    .strict(),
]);
export const cardHuntInput = z
  .object({
    sources: z
      .array(sourceSchema)
      .min(1, "Select at least one deck or add a pasted list.")
      .max(20, "Use up to 20 decks or lists.")
      .optional(),
    deckId: z.string().trim().min(1).max(100).optional(),
    text: z.string().max(100_000).optional(),
    card: z
      .object({
        id: z.string().trim().min(1).max(100),
        scope: z.enum(["card", "printing"]),
        finish: z.enum(["NONFOIL", "FOIL", "ETCHED"]).optional(),
      })
      .optional(),
    mode: z.enum(["preferences", "boxes"]).default("preferences"),
    finish: z.enum(["ANY", "NONFOIL", "FOIL", "ETCHED"]).default("ANY"),
    adjustments: huntAdjustmentsInput.optional(),
    printingRequestId: z.string().min(1).max(500).optional(),
    includeMaybeboard: z.boolean().default(false),
    ignoreBasicLands: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (
      [value.deckId, value.text?.trim(), value.card, value.sources].filter(
        Boolean,
      ).length !== 1
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a deck, paste lists, or choose a card.",
      });
    if (value.sources) {
      const ids = value.sources.map((source) => source.id);
      const deckIds = value.sources.flatMap((source) =>
        source.kind === "DECK" ? [source.deckId] : [],
      );
      if (
        new Set(ids).size !== ids.length ||
        new Set(deckIds).size !== deckIds.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Each deck or list must appear only once.",
        });
      if (
        value.sources.reduce(
          (total, source) =>
            total + (source.kind === "LIST" ? source.text.length : 0),
          0,
        ) > 100_000
      )
        ctx.addIssue({
          code: "custom",
          message: "Use at most 100,000 characters across pasted lists.",
        });
    }
  });

export type CardHuntInput = z.infer<typeof cardHuntInput>;
export function huntTargetStamp(row: {
  id: string;
  cardId: string | null;
  oracleId: string | null;
  cardName: string;
  quantity: number;
  section: string;
  updatedAt: Date;
}) {
  return handoffHash([
    row.id,
    row.cardId,
    row.oracleId,
    row.cardName,
    row.quantity,
    row.section,
    row.updatedAt.toISOString(),
  ]);
}

export class CardHuntError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type HuntDb = PrismaClient | Prisma.TransactionClient;

export async function buildCardHunt(
  db: HuntDb,
  user: { id: string; playerId: string | null },
  rawInput: unknown,
) {
  const parsed = cardHuntInput.safeParse(rawInput);
  if (!parsed.success)
    throw new CardHuntError(parsed.error.issues[0]?.message ?? "Invalid hunt.");
  if (!user.playerId)
    throw new CardHuntError(
      "Link your account to an inventory owner to hunt cards.",
    );
  const input = parsed.data;
  const currentUser = await db.user.findUnique({
    where: { id: user.id },
    select: {
      isActive: true,
      forcePasswordChange: true,
      playerId: true,
      player: { select: { active: true } },
    },
  });
  if (
    !currentUser?.isActive ||
    currentUser.forcePasswordChange ||
    currentUser.playerId !== user.playerId ||
    !currentUser.player?.active
  )
    throw new CardHuntError(
      "Your inventory account changed. Sign in again before planning a hunt.",
      403,
    );
  let title = "Pasted card list";
  let requests: HuntRequest[] = [];
  const warnings: string[] = [];
  const basicLandIds = new Set<string>();
  const card = input.card
    ? await db.card.findUnique({
        where: { id: input.card.id },
        select: {
          id: true,
          name: true,
          oracleId: true,
          setCode: true,
          collectorNumber: true,
        },
      })
    : null;
  if (input.card && !card) throw new CardHuntError("Card not found.", 404);
  const sources =
    input.sources ??
    (input.deckId
      ? [
          {
            kind: "DECK" as const,
            id: `deck:${input.deckId}`,
            deckId: input.deckId,
          },
        ]
      : input.text?.trim()
        ? [
            {
              kind: "LIST" as const,
              id: "list:legacy",
              label: "Pasted card list",
              text: input.text,
            },
          ]
        : []);
  const sourceTitles: Array<{ id: string; label: string; deckId?: string }> =
    [];
  for (const source of sources) {
    if (source.kind === "DECK") {
      // Even administrator mode cannot plan against someone else's deck/stock.
      const deck = await db.deck.findFirst({
        where: { id: source.deckId, ownerUserId: user.id },
        select: {
          name: true,
          commanderLeagueDeck: { select: { id: true } },
          cards: {
            where: input.includeMaybeboard
              ? {}
              : { section: { not: "MAYBEBOARD" } },
            orderBy: [{ section: "asc" }, { id: "asc" }],
            select: {
              id: true,
              cardId: true,
              oracleId: true,
              cardName: true,
              quantity: true,
              section: true,
              updatedAt: true,
              card: {
                select: {
                  oracleId: true,
                  setCode: true,
                  collectorNumber: true,
                  ...(input.ignoreBasicLands
                    ? { typeLine: true, cardFaces: true }
                    : {}),
                },
              },
            },
          },
        },
      });
      if (!deck) throw new CardHuntError("Deck not found.", 404);
      if (deck.commanderLeagueDeck)
        throw new CardHuntError(
          "Card Hunt uses personal storage. League decks use their League pool.",
        );
      sourceTitles.push({
        id: source.id,
        label: deck.name,
        deckId: source.deckId,
      });
      const requestId = (id: string) =>
        input.deckId ? id : JSON.stringify([source.id, id]);
      if (input.ignoreBasicLands)
        for (const entry of deck.cards)
          if (isBasicLandCard(entry.card))
            basicLandIds.add(requestId(entry.id));
      requests.push(
        ...deck.cards.map((row) => ({
          id: requestId(row.id),
          name: row.cardName,
          quantity: row.quantity,
          cardId: row.cardId,
          oracleId: row.oracleId ?? row.card?.oracleId,
          setCode: row.card?.setCode,
          collectorNumber: row.card?.collectorNumber,
          sourceId: source.id,
          sourceLabel: deck.name,
          deckId: source.deckId,
          deckCardId: row.id,
          targetStamp: huntTargetStamp(row),
        })),
      );
    } else {
      const parsedList = parseDecklistText(source.text);
      const lines = parsedList.lines.filter(
        (line) => input.includeMaybeboard || line.section !== "MAYBEBOARD",
      );
      if (
        lines.some(
          (line) =>
            line.errors.length ||
            !line.parsedName ||
            !line.quantity ||
            /^0+\s*x?\s+/i.test(line.rawLine.trim()),
        )
      )
        throw new CardHuntError(
          `One or more card lines in ${source.label} could not be read. Use a quantity and card name on each line.`,
        );
      if (!lines.length)
        throw new CardHuntError(`Add at least one card to ${source.label}.`);
      sourceTitles.push({ id: source.id, label: source.label });
      warnings.push(
        ...lines.flatMap((line) =>
          line.warnings.map(
            (warning) => `${source.label}, line ${line.lineNumber}: ${warning}`,
          ),
        ),
      );
      requests.push(
        ...lines.map((line) => ({
          id: input.text
            ? String(line.lineNumber)
            : JSON.stringify([source.id, line.lineNumber]),
          name: line.parsedName!,
          quantity: line.quantity!,
          setCode: line.parsedSetCode,
          collectorNumber: line.parsedCollectorNumber,
          finish: line.foil ? ("FOIL" as const) : undefined,
          sourceId: source.id,
          sourceLabel: source.label,
        })),
      );
    }
  }
  title =
    sourceTitles.length === 1
      ? sourceTitles[0].label
      : `Combined hunt (${sourceTitles.length} decks/lists)`;
  if (!requests.length && !input.card)
    throw new CardHuntError("Add at least one card to hunt.");
  if (!input.sources && requests.length > 500)
    throw new CardHuntError(
      "Use up to 500 card lines in a single-source hunt.",
    );
  if (
    requests.length > 1000 ||
    requests.some(
      (request) =>
        !Number.isSafeInteger(request.quantity) ||
        request.quantity < 1 ||
        request.quantity > 1_000_000,
    )
  )
    throw new CardHuntError(
      "Use up to 1,000 combined card lines with whole quantities from 1 to 1,000,000.",
    );

  let ignoredBasicLandCopies = 0;
  if (basicLandIds.size) {
    requests = requests.filter((request) => {
      if (!basicLandIds.has(request.id)) return true;
      ignoredBasicLandCopies += request.quantity;
      return false;
    });
  }
  const ownedLocations = await db.inventoryLocation.findMany({
    where: { ownerPlayerId: user.playerId },
  });
  const locationParents = new Map(ownedLocations.map((row) => [row.id, row]));
  const paths = buildLocationPathMap(ownedLocations);
  const result = (stock: HuntStock[]) => {
    try {
      return {
        locations: ownedLocations
          .filter(
            (row) => row.kind === "NORMAL" && !row.systemManaged && row.active,
          )
          .map((row) => ({
            id: row.id,
            name: paths.get(row.id) ?? row.name,
            isBulk: locationIsBulk(row.id, locationParents),
          })),
        title,
        warnings,
        sources: sourceTitles,
        actorUserId: user.id,
        generatedAt: new Date().toISOString(),
        ignoredBasicLandCopies,
        ...planCardHunt({
          ownerId: user.playerId!,
          requests,
          stock,
          adjustments: input.adjustments,
          printingRequestId: input.printingRequestId,
          locationParents,
          mode: input.mode,
          finish: input.finish,
        }),
      };
    } catch (error) {
      throw new CardHuntError(
        error instanceof Error
          ? error.message
          : "Could not re-evaluate the hunt.",
        409,
      );
    }
  };
  // An all-basic deck is a valid empty hunt when the user opted to skip basics.
  if (!requests.length && !input.card) return result([]);

  const cardIds = [
    ...new Set(
      requests.flatMap((request) => (request.cardId ? [request.cardId] : [])),
    ),
  ];
  const oracleIds = [
    ...new Set(
      requests.flatMap((request) =>
        request.oracleId ? [request.oracleId] : [],
      ),
    ),
  ];
  const names = [
    ...new Set(
      requests
        .filter((request) => !request.oracleId)
        .map((request) => request.name),
    ),
  ];
  let match: Prisma.InventoryItemWhereInput = {
    OR: [
      { cardId: { in: cardIds } },
      { card: { oracleId: { in: oracleIds } } },
      ...names.map((name) => ({
        card: { name: { equals: name, mode: Prisma.QueryMode.insensitive } },
      })),
    ],
  };
  if (card && input.card) {
    title = card.name;
    match =
      input.card.scope === "printing"
        ? { cardId: card.id, foilStatus: input.card.finish }
        : card.oracleId
          ? { card: { oracleId: card.oracleId } }
          : {
              card: {
                name: { equals: card.name, mode: Prisma.QueryMode.insensitive },
                OR: [{ oracleId: null }, { oracleId: "" }],
              },
            };
  }
  const items = await db.inventoryItem.findMany({
    where: { currentOwnerId: user.playerId, quantity: { gt: 0 }, ...match },
    orderBy: { id: "asc" },
    include: {
      card: {
        select: {
          id: true,
          name: true,
          oracleId: true,
          setCode: true,
          collectorNumber: true,
          imageUri: true,
          cardFaces: true,
          manaCost: true,
          typeLine: true,
          rarity: true,
          oracleText: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
          ownerPlayerId: true,
          active: true,
          kind: true,
          deckId: true,
          type: true,
          normalizedName: true,
          systemManaged: true,
        },
      },
    },
  });
  const ids = items.map((item) => item.id);
  const activeStatuses = [
    TradeStatus.PROPOSED,
    TradeStatus.ACCEPTED_PENDING_EXCHANGE,
    TradeStatus.PARTIALLY_COMMITTED,
  ];
  const [lines, legacy] = ids.length
    ? await Promise.all([
        db.tradeLine.findMany({
          where: {
            inventoryItemId: { in: ids },
            trade: { status: { in: activeStatuses } },
          },
          select: { inventoryItemId: true, quantity: true },
        }),
        db.trade.findMany({
          where: {
            status: { in: activeStatuses },
            lines: { none: {} },
            OR: [
              { offeredInventoryItemId: { in: ids } },
              { requestedInventoryItemId: { in: ids } },
            ],
          },
          select: {
            offeredInventoryItemId: true,
            requestedInventoryItemId: true,
          },
        }),
      ])
    : [[], []];
  const reserved = buildReservedInventoryQuantities(lines, legacy);
  const stock: HuntStock[] = items.map((item) => ({
    id: item.id,
    ownerId: item.currentOwnerId,
    quantity: item.quantity,
    reserved: reserved.get(item.id) ?? 0,
    cardId: item.cardId,
    oracleId: item.card.oracleId,
    name: item.card.name,
    setCode: item.card.setCode,
    collectorNumber: item.card.collectorNumber,
    finish: item.foilStatus,
    language: item.language,
    condition: item.condition,
    stamp: handoffStamp(item),
    card: item.card,
    isBulk: locationIsBulk(item.locationId, locationParents),
    location: item.location
      ? {
          id: item.location.id,
          name: paths.get(item.location.id) ?? item.location.name,
          section: item.locationSection,
          ownerId: item.location.ownerPlayerId,
          active: item.location.active,
          isDeck: isSystemDeckLocation(item.location),
        }
      : null,
  }));
  if (card && input.card) {
    const quantity = stock.reduce(
      (total, item) =>
        total +
        (isPullableHuntStock(item, user.playerId!)
          ? Math.max(0, item.quantity - item.reserved)
          : 0),
      0,
    );
    if (!quantity) return result([]);
    requests = [
      {
        id: card.id,
        name: card.name,
        quantity,
        ...(input.card.scope === "printing"
          ? {
              cardId: card.id,
              setCode: card.setCode,
              collectorNumber: card.collectorNumber,
              finish: input.card.finish,
            }
          : { oracleId: card.oracleId }),
      },
    ];
  }
  for (const source of sources.filter((source) => source.kind === "DECK")) {
    if (source.kind !== "DECK") continue;
    const deckRequests = requests.filter(
      (request) => request.deckId === source.deckId,
    );
    const allocated = planCommittedDeckPrintings(
      deckRequests.map((request) => ({ ...request, cardName: request.name })),
      items.filter(
        (item) =>
          item.currentOwnerId === user.playerId &&
          item.location?.ownerPlayerId === user.playerId &&
          item.location.deckId === source.deckId,
      ),
    );
    for (const [index, request] of deckRequests.entries())
      request.alreadyInDeck = allocated[index].committed;
  }
  return result(stock);
}
