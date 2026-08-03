import Link from "next/link";
import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import {
  DeckWorkspace,
  type DeckWorkspaceDeck,
  type DeckWorkspaceTag,
} from "@/components/DeckWorkspace";
import { isBasicLandCard } from "@/lib/card-types";
import { bracketSelectOptions, parseDeckBracket } from "@/lib/deck-brackets";
import {
  buildDeckFolderOptions,
  calculateDeckColorIdentity,
} from "@/lib/deck-folders";
import {
  deckFormatLabel,
  deckSectionSummaryParts,
  publicDeckWhere,
  summarizeEffectiveDeckCoverage,
} from "@/lib/decks";
import { prisma } from "@/lib/prisma";
import { visibilityLabel } from "@/lib/visibility";

export const dynamic = "force-dynamic";

function deckCardArtCrop(
  card: { imageUris: unknown; imageUri: string | null } | null,
) {
  if (!card) return "";
  const images = card.imageUris as
    { art_crop?: string; normal?: string; small?: string } | null | undefined;
  return (
    images?.art_crop ?? images?.normal ?? images?.small ?? card.imageUri ?? ""
  );
}

function publicTagId(name: string) {
  return `public-tag:${name.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export default async function PublicDecksPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string; bracket?: string; tag?: string }>;
}) {
  const params = await searchParams;
  const selectedBracket = parseDeckBracket(params?.bracket ?? null);
  const decks = await prisma.deck.findMany({
    where: publicDeckWhere(),
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
      ownerUser: {
        select: {
          id: true,
          publicDisplayName: true,
          displayName: true,
        },
      },
      tags: {
        include: { tag: { select: { name: true } } },
        orderBy: { tag: { name: "asc" } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const ownerIds = [...new Set(decks.map((deck) => deck.ownerUserId))];
  const allOwnerFolders = ownerIds.length
    ? await prisma.deckFolder.findMany({
        where: { ownerUserId: { in: ownerIds } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      })
    : [];
  const rawFolderById = new Map(
    allOwnerFolders.map((folder) => [folder.id, folder]),
  );
  const visibleFolderIds = new Set<string>();
  for (const deck of decks) {
    let folderId = deck.folderId;
    const seen = new Set<string>();
    while (folderId && !seen.has(folderId)) {
      visibleFolderIds.add(folderId);
      seen.add(folderId);
      folderId = rawFolderById.get(folderId)?.parentId ?? null;
    }
  }
  const ownerLabelById = new Map(
    decks.map((deck) => [
      deck.ownerUserId,
      deck.ownerUser.publicDisplayName || deck.ownerUser.displayName,
    ]),
  );
  const folderOptions = buildDeckFolderOptions(
    allOwnerFolders.map((folder) => ({
      ...folder,
      name: folder.parentId
        ? folder.name
        : `${ownerLabelById.get(folder.ownerUserId) ?? "Owner"} · ${folder.name}`,
    })),
  ).filter((folder) => visibleFolderIds.has(folder.id));
  const folderById = new Map(
    folderOptions.map((folder) => [folder.id, folder]),
  );

  const tagStats = new Map<string, DeckWorkspaceTag>();
  const deckTags = new Map<string, Array<{ id: string; name: string }>>();
  for (const deck of decks) {
    const tags = deck.tags.map(({ tag }) => ({
      id: publicTagId(tag.name),
      name: tag.name,
    }));
    deckTags.set(deck.id, tags);
    for (const tag of tags) {
      const existing = tagStats.get(tag.id);
      if (existing) existing.count += 1;
      else tagStats.set(tag.id, { ...tag, count: 1 });
    }
  }
  const workspaceTags = [...tagStats.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

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
        ? (folderById.get(deck.folderId)?.path ?? "Public folder")
        : "Uncategorized",
      tags: deckTags.get(deck.id) ?? [],
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
      ownerLabel:
        deck.ownerUser.publicDisplayName || deck.ownerUser.displayName,
    };
  });

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <nav className="flex flex-wrap gap-4 border-b border-zinc-800 pb-4 text-sm">
        <Link href="/public" className="font-bold text-sky-200">
          Public collections
        </Link>
        <Link href="/public/inventory">Public inventory</Link>
        <Link href="/public/decks">Public decks</Link>
        <Link href="/login">Log in</Link>
      </nav>
      <section className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Public decks</h1>
          <p className="mt-1 text-zinc-400">
            Search and explore shared decks in a read-only workspace.
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
        readOnly
        showOwner
      />
    </main>
  );
}
