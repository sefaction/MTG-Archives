import { Prisma, TradeStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseDecklistText } from "./deck-import";
import { isSystemDeckLocation } from "./deck-inventory";
import { buildReservedInventoryQuantities } from "./trade-lines";
import { huntMatches, huntPrintingMatches, planCardHunt, type HuntRequest, type HuntStock } from "./card-hunt";

export const cardHuntInput = z.object({
  deckId: z.string().trim().min(1).max(100).optional(),
  text: z.string().max(100_000).optional(),
  mode: z.enum(["preferences", "boxes"]).default("preferences"),
  finish: z.enum(["ANY", "NONFOIL", "FOIL", "ETCHED"]).default("ANY"),
  includeMaybeboard: z.boolean().default(false),
}).refine(value => Boolean(value.deckId) !== Boolean(value.text?.trim()), {
  message: "Choose a deck or paste a card list.",
});

export class CardHuntError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type HuntDb = PrismaClient | Prisma.TransactionClient;

export async function buildCardHunt(
  db: HuntDb,
  user: {id: string; playerId: string | null},
  rawInput: unknown,
) {
  const parsed = cardHuntInput.safeParse(rawInput);
  if (!parsed.success) throw new CardHuntError(parsed.error.issues[0]?.message ?? "Invalid hunt.");
  if (!user.playerId) throw new CardHuntError("Link your account to an inventory owner to hunt cards.");
  const input = parsed.data;
  let title = "Pasted card list";
  let requests: HuntRequest[];
  const warnings: string[] = [];
  if (input.deckId) {
    // Even administrator mode cannot silently plan against someone else's stock.
    const deck = await db.deck.findFirst({
      where: {id: input.deckId, ownerUserId: user.id},
      select: {name: true, commanderLeagueDeck: {select: {id: true}}, cards: {
        where: input.includeMaybeboard ? {} : {section: {not: "MAYBEBOARD"}},
        orderBy: [{section: "asc"}, {id: "asc"}],
        select: {id: true, cardId: true, oracleId: true, cardName: true, quantity: true,
          card: {select: {oracleId: true, setCode: true, collectorNumber: true}}},
      }},
    });
    if (!deck) throw new CardHuntError("Deck not found.", 404);
    if (deck.commanderLeagueDeck) throw new CardHuntError("Card Hunt uses personal storage. League decks use their League pool.");
    title = deck.name;
    requests = deck.cards.map(card => ({id: card.id, name: card.cardName,
      quantity: card.quantity, cardId: card.cardId, oracleId: card.oracleId ?? card.card?.oracleId,
      setCode: card.card?.setCode, collectorNumber: card.card?.collectorNumber}));
  } else {
    const source = parseDecklistText(input.text!);
    const lines = source.lines.filter(line => input.includeMaybeboard || line.section !== "MAYBEBOARD");
    if (lines.some(line => line.errors.length || !line.parsedName || !line.quantity || /^0+\s*x?\s+/i.test(line.rawLine.trim())))
      throw new CardHuntError("One or more card lines could not be read. Use a quantity and card name on each line.");
    warnings.push(...lines.flatMap(line => line.warnings.map(warning => `Line ${line.lineNumber}: ${warning}`)));
    requests = lines.map(line => ({id: String(line.lineNumber), name: line.parsedName!,
      quantity: line.quantity!, setCode: line.parsedSetCode, collectorNumber: line.parsedCollectorNumber,
      finish: line.foil ? "FOIL" : undefined}));
  }
  if (!requests.length) throw new CardHuntError("Add at least one card to hunt.");
  if (requests.length > 500 || requests.some(request => !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 1_000_000))
    throw new CardHuntError("Use up to 500 card lines with whole quantities from 1 to 1,000,000.");

  const cardIds = [...new Set(requests.flatMap(request => request.cardId ? [request.cardId] : []))];
  const oracleIds = [...new Set(requests.flatMap(request => request.oracleId ? [request.oracleId] : []))];
  const names = [...new Set(requests.filter(request => !request.oracleId).map(request => request.name))];
  const items = await db.inventoryItem.findMany({
    where: {currentOwnerId: user.playerId, quantity: {gt: 0}, OR: [
      {cardId: {in: cardIds}}, {card: {oracleId: {in: oracleIds}}},
      ...names.map(name => ({card: {name: {equals: name, mode: Prisma.QueryMode.insensitive}}})),
    ]},
    orderBy: {id: "asc"},
    select: {id: true, currentOwnerId: true, quantity: true, cardId: true, foilStatus: true,
      language: true, condition: true, locationSection: true,
      card: {select: {id: true, name: true, oracleId: true, setCode: true, collectorNumber: true}},
      location: {select: {id: true, name: true, ownerPlayerId: true, active: true, kind: true,
        deckId: true, type: true, normalizedName: true, systemManaged: true}},
    },
  });
  const ids = items.map(item => item.id);
  const activeStatuses = [TradeStatus.PROPOSED, TradeStatus.ACCEPTED_PENDING_EXCHANGE, TradeStatus.PARTIALLY_COMMITTED];
  const [lines, legacy] = ids.length ? await Promise.all([
    db.tradeLine.findMany({where: {inventoryItemId: {in: ids}, trade: {status: {in: activeStatuses}}},
      select: {inventoryItemId: true, quantity: true}}),
    db.trade.findMany({where: {status: {in: activeStatuses}, lines: {none: {}}, OR: [
      {offeredInventoryItemId: {in: ids}}, {requestedInventoryItemId: {in: ids}},
    ]}, select: {offeredInventoryItemId: true, requestedInventoryItemId: true}}),
  ]) : [[], []];
  const reserved = buildReservedInventoryQuantities(lines, legacy);
  const stock: HuntStock[] = items.map(item => ({id: item.id, ownerId: item.currentOwnerId,
    quantity: item.quantity, reserved: reserved.get(item.id) ?? 0, cardId: item.cardId,
    oracleId: item.card.oracleId, name: item.card.name, setCode: item.card.setCode,
    collectorNumber: item.card.collectorNumber, finish: item.foilStatus,
    language: item.language, condition: item.condition,
    location: item.location ? {id: item.location.id, name: item.location.name,
      section: item.locationSection, ownerId: item.location.ownerPlayerId,
      active: item.location.active, isDeck: isSystemDeckLocation(item.location)} : null}));
  if (input.deckId) {
    const committed = new Map(items.filter(item => item.currentOwnerId === user.playerId &&
      item.location?.ownerPlayerId === user.playerId && item.location.deckId === input.deckId)
      .map(item => [item.id, item.quantity]));
    for (const request of requests) {
      let needed = request.quantity;
      for (const item of [...stock].sort((a, b) => Number(huntPrintingMatches(request, b)) - Number(huntPrintingMatches(request, a)))) {
        if (!huntMatches(request, item)) continue;
        const used = Math.min(needed, committed.get(item.id) ?? 0);
        needed -= used;
        if (used) committed.set(item.id, committed.get(item.id)! - used);
        if (!needed) break;
      }
      request.alreadyInDeck = request.quantity - needed;
    }
  }
  return {title, warnings, generatedAt: new Date().toISOString(),
    ...planCardHunt({ownerId: user.playerId, requests, stock, mode: input.mode, finish: input.finish})};
}
