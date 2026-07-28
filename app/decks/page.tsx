export const dynamic = "force-dynamic";

import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import {
  DeckWorkspace,
  type DeckWorkspaceDeck,
  type DeckWorkspaceTag,
} from "@/components/DeckWorkspace";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { isBasicLandCard } from "@/lib/card-types";
import { prisma } from "@/lib/prisma";
import {
  deckFormatLabel,
  deckSectionSummaryParts,
  summarizeEffectiveDeckCoverage,
} from "@/lib/decks";
import { bracketSelectOptions, parseDeckBracket } from "@/lib/deck-brackets";
import {
  buildDeckFolderOptions,
  calculateDeckColorIdentity,
} from "@/lib/deck-folders";
import { visibilityLabel } from "@/lib/visibility";

function deckCardArtCrop(
  card: {
    imageUris: unknown;
    imageUri: string | null;
  } | null,
) {
  if (!card) return "";
  const images = card.imageUris as
    { art_crop?: string; normal?: string; small?: string } | null | undefined;
  return (
    images?.art_crop ?? images?.normal ?? images?.small ?? card.imageUri ?? ""
  );
}

export default async function DecksPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string; bracket?: string; tag?: string }>;
}) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const adminModeActive = scope?.mode === "admin";
  const params = await searchParams;
  const selectedBracket = parseDeckBracket(params?.bracket ?? null);

  const [folders, tags, decks] = await Promise.all([
    prisma.deckFolder.findMany({
      where: adminModeActive ? {} : { ownerUserId: user.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.deckTag.findMany({
      where: adminModeActive ? {} : { ownerUserId: user.id },
      include: {
        ownerUser: { select: { displayName: true } },
        _count: { select: { decks: true } },
      },
      orderBy: [{ name: "asc" }, { ownerUserId: "asc" }],
    }),
    prisma.deck.findMany({
      where: adminModeActive ? {} : { ownerUserId: user.id },
      include: {
        cards: {
          select: {
            cardId: true,
            cardName: true,
            quantity: true,
            section: true,
            isCommander: true,
            card: {
              select: {
                id: true,
                colorIdentity: true,
                colors: true,
                typeLine: true,
                cardFaces: true,
                imageUris: true,
                imageUri: true,
              },
            },
          },
        },
        deckLocation: {
          select: {
            inventoryItems: {
              where: { quantity: { gt: 0 } },
              select: { cardId: true, quantity: true },
            },
          },
        },
        ownerUser: { select: { displayName: true } },
        tags: {
          include: { tag: { select: { id: true, name: true } } },
          orderBy: { tag: { name: "asc" } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const folderOptions = buildDeckFolderOptions(folders);
  const folderById = new Map(
    folderOptions.map((folder) => [folder.id, folder]),
  );
  const workspaceTags: DeckWorkspaceTag[] = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    count: tag._count.decks,
    ownerLabel: adminModeActive ? tag.ownerUser.displayName : undefined,
  }));
  const workspaceDecks: DeckWorkspaceDeck[] = decks.map((deck) => {
    const primaryCards = deck.cards.filter(
      (deckCard) =>
        deckCard.section === DeckSection.MAINBOARD ||
        deckCard.section === DeckSection.COMMANDER,
    );
    const requiredByCardId = new Map<
      string,
      { quantity: number; isBasicLand: boolean }
    >();
    for (const deckCard of primaryCards) {
      if (!deckCard.cardId) continue;
      const current = requiredByCardId.get(deckCard.cardId);
      requiredByCardId.set(deckCard.cardId, {
        quantity: (current?.quantity ?? 0) + deckCard.quantity,
        isBasicLand:
          Boolean(current?.isBasicLand) || isBasicLandCard(deckCard.card),
      });
    }
    const committedByCardId = new Map<string, number>();
    for (const item of deck.deckLocation?.inventoryItems ?? []) {
      committedByCardId.set(
        item.cardId,
        (committedByCardId.get(item.cardId) ?? 0) + item.quantity,
      );
    }
    const committedCardCount = summarizeEffectiveDeckCoverage(
      [...requiredByCardId].map(([cardId, { quantity, isBasicLand }]) => ({
        quantity,
        exactOwned: 0,
        otherOwned: 0,
        committedToThisDeck: committedByCardId.get(cardId) ?? 0,
        isBasicLand,
      })),
    ).effectiveCommitted;

    return {
      id: deck.id,
      name: deck.name,
      description: deck.description,
      format: deck.format,
      formatLabel: deckFormatLabel(deck.format),
      visibility: deck.visibility,
      visibilityLabel: visibilityLabel(deck.visibility),
      bracket: deck.bracket,
      folderId: deck.folderId,
      folderPath: deck.folderId
        ? (folderById.get(deck.folderId)?.path ?? "Unknown folder")
        : "Uncategorized",
      tags: deck.tags.map(({ tag }) => tag),
      colorIdentity: calculateDeckColorIdentity(deck.cards, deck.format),
      cardSummary: deckSectionSummaryParts(deck.cards).join(" · "),
      cardCount: primaryCards.reduce((total, card) => total + card.quantity, 0),
      committedCardCount,
      commanderNames: [
        ...new Set(
          deck.cards
            .filter(
              (deckCard) =>
                deckCard.isCommander ||
                deckCard.section === DeckSection.COMMANDER,
            )
            .map((deckCard) => deckCard.cardName)
            .filter(Boolean),
        ),
      ],
      commanderImages: [
        ...new Set(
          deck.cards
            .filter(
              (deckCard) =>
                deckCard.isCommander ||
                deckCard.section === DeckSection.COMMANDER,
            )
            .map((deckCard) => deckCardArtCrop(deckCard.card))
            .filter(Boolean),
        ),
      ],
      updatedAt: deck.updatedAt.toISOString(),
      ownerLabel: adminModeActive ? deck.ownerUser.displayName : undefined,
    };
  });

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Nav />
      <section className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Decks</h1>
          <p className="mt-1 text-zinc-400">
            Browse, organize, and update your decks from one workspace.
          </p>
        </div>
        <div className="flex gap-4 text-sm text-zinc-500">
          <span>
            <strong className="text-zinc-200">{workspaceDecks.length}</strong>{" "}
            decks
          </span>
          <span>
            <strong className="text-zinc-200">{folderOptions.length}</strong>{" "}
            folders
          </span>
          <span>
            <strong className="text-zinc-200">{workspaceTags.length}</strong>{" "}
            tags
          </span>
        </div>
      </section>
      {adminModeActive ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
          Admin mode is active. This workspace includes decks across users.
        </p>
      ) : null}
      <DeckWorkspace
        decks={workspaceDecks}
        folders={folderOptions}
        tags={workspaceTags}
        formatOptions={Object.values(DeckFormat).map((format) => ({
          value: format,
          label: deckFormatLabel(format),
        }))}
        visibilityOptions={Object.values(Visibility).map((visibility) => ({
          value: visibility,
          label: visibilityLabel(visibility),
        }))}
        bracketOptions={bracketSelectOptions()}
        initialFolder={params?.folder ?? "all"}
        initialTag={params?.tag ?? ""}
        initialBracket={selectedBracket ? String(selectedBracket) : ""}
        adminModeActive={adminModeActive}
      />
    </main>
  );
}
