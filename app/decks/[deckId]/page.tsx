export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DeckFormat,
  DeckSection,
  InventoryLocationKind,
  Visibility,
} from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { ColorIdentitySymbols } from "@/components/mtg/ColorIdentitySymbols";
import {
  buildDeckFolderOptions,
  calculateDeckColorIdentity,
  folderSelectLabel,
} from "@/lib/deck-folders";
import {
  canManageDeck,
  canViewDeck,
  deckFormatLabel,
  deckSections,
  deckSectionQuantityTotals,
  deckTotalQuantity,
  summarizeDeckCardOwnership,
} from "@/lib/decks";
import { bracketSelectOptions, formatDeckBracket } from "@/lib/deck-brackets";
import {
  getDeckCommittedSummary,
  isNormalInventoryLocation,
} from "@/lib/deck-inventory";
import {
  isDeckLocation,
  matchesDeckCardPrinting,
} from "@/lib/deck-commitments";
import { cardPriceNumber } from "@/lib/deck-view";
import { ensureDefaultLocation } from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";
import { resolveDeckVisibility, visibilityLabel } from "@/lib/visibility";
import {
  deleteDeck,
  returnAllCommittedDeckInventory,
  updateDeck,
} from "../actions";
import { DeckActionPanels } from "@/components/DeckActionPanels";
import { DeckCardPicker } from "@/components/DeckCardPicker";
import { DeckImportPanel } from "@/components/DeckImportPanel";
import {
  DeckListEditor,
  type DeckReturnLocation,
} from "@/components/DeckListEditor";
import {
  cn,
  filterDangerButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";

type DeckPageInventoryItem = {
  id: string;
  cardId: string;
  quantity: number;
  locationId: string | null;
  card: {
    id: string;
    oracleId: string | null;
    name: string;
    setCode: string;
    collectorNumber: string;
  };
  location: {
    id: string;
    name: string;
    kind: InventoryLocationKind;
    deckId: string | null;
  } | null;
};

function normalizeDeckMatchName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function unique<T>(values: Array<T | null | undefined>) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))];
}

function candidatesForDeckCard(
  deckCard: {
    cardId?: string | null;
    oracleId?: string | null;
    cardName: string;
  },
  maps: {
    byCardId: Map<string, DeckPageInventoryItem[]>;
    byOracleId: Map<string, DeckPageInventoryItem[]>;
    byName: Map<string, DeckPageInventoryItem[]>;
  },
) {
  const seen = new Set<string>();
  const candidates: DeckPageInventoryItem[] = [];
  function push(items: DeckPageInventoryItem[] | undefined) {
    for (const item of items ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      candidates.push(item);
    }
  }
  if (deckCard.cardId) push(maps.byCardId.get(deckCard.cardId));
  if (deckCard.oracleId) push(maps.byOracleId.get(deckCard.oracleId));
  if (!deckCard.oracleId) {
    push(maps.byName.get(normalizeDeckMatchName(deckCard.cardName)));
  }
  return candidates;
}

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const user = await getCurrentUser();
  const scope = user ? await getAccessScope(user) : null;
  const { deckId } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: {
      ownerUser: true,
      cards: {
        include: {
          card: true,
        },
        orderBy: [{ section: "asc" }, { cardName: "asc" }],
      },
    },
  });
  if (!deck || !canViewDeck(user, deck, scope?.mode === "admin")) notFound();

  const canEdit = canManageDeck(user, deck, scope?.mode === "admin");
  const folderOptions = canEdit
    ? buildDeckFolderOptions(
        await prisma.deckFolder.findMany({
          where: { ownerUserId: deck.ownerUserId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      )
    : [];
  const deckColorIdentity = calculateDeckColorIdentity(deck.cards, deck.format);
  const effectiveVisibility = resolveDeckVisibility(
    deck.ownerUser.deckDefaultVisibility,
    deck.visibility,
  );
  const inventoryOwnerId = canEdit ? deck.ownerUser.playerId : null;
  if (inventoryOwnerId) await ensureDefaultLocation(prisma, inventoryOwnerId);

  const deckCardIds = unique(deck.cards.map((card) => card.cardId));
  const deckOracleIds = unique(deck.cards.map((card) => card.oracleId));
  const genericDeckNames = unique(
    deck.cards
      .filter((card) => !card.oracleId)
      .map((card) => card.cardName.trim().replace(/\s+/g, " ")),
  );
  const inventoryWhereClauses = [
    deckCardIds.length ? { cardId: { in: deckCardIds } } : null,
    deckOracleIds.length ? { card: { oracleId: { in: deckOracleIds } } } : null,
    genericDeckNames.length
      ? { card: { name: { in: genericDeckNames } } }
      : null,
  ].filter((clause): clause is NonNullable<typeof clause> => Boolean(clause));
  const inventoryItems: DeckPageInventoryItem[] =
    inventoryOwnerId && inventoryWhereClauses.length
      ? await prisma.inventoryItem.findMany({
          where: {
            currentOwnerId: inventoryOwnerId,
            quantity: { gt: 0 },
            OR: inventoryWhereClauses,
          },
          select: {
            id: true,
            cardId: true,
            quantity: true,
            locationId: true,
            card: {
              select: {
                id: true,
                oracleId: true,
                name: true,
                setCode: true,
                collectorNumber: true,
              },
            },
            location: {
              select: {
                id: true,
                name: true,
                kind: true,
                deckId: true,
              },
            },
          },
        })
      : [];
  const inventoryMaps = inventoryItems.reduce(
    (maps, item) => {
      const byCard = maps.byCardId.get(item.cardId) ?? [];
      byCard.push(item);
      maps.byCardId.set(item.cardId, byCard);
      if (item.card.oracleId) {
        const byOracle = maps.byOracleId.get(item.card.oracleId) ?? [];
        byOracle.push(item);
        maps.byOracleId.set(item.card.oracleId, byOracle);
      }
      const normalizedName = normalizeDeckMatchName(item.card.name);
      const byName = maps.byName.get(normalizedName) ?? [];
      byName.push(item);
      maps.byName.set(normalizedName, byName);
      return maps;
    },
    {
      byCardId: new Map<string, DeckPageInventoryItem[]>(),
      byOracleId: new Map<string, DeckPageInventoryItem[]>(),
      byName: new Map<string, DeckPageInventoryItem[]>(),
    },
  );
  if (process.env.DEBUG_DECK_PERFORMANCE === "true") {
    console.info("[deck-detail] diagnostics", {
      deckId: deck.id,
      deckCardCount: deck.cards.length,
      inventoryCandidateCount: inventoryItems.length,
      exactCardKeys: deckCardIds.length,
      oracleKeys: deckOracleIds.length,
      genericNameKeys: genericDeckNames.length,
    });
  }
  const normalReturnLocations: DeckReturnLocation[] = deck.ownerUser.playerId
    ? (
        await prisma.inventoryLocation.findMany({
          where: { ownerPlayerId: deck.ownerUser.playerId, active: true },
          orderBy: [{ normalizedName: "asc" }],
        })
      )
        .filter(isNormalInventoryLocation)
        .map((location) => ({ id: location.id, name: location.name }))
    : [];
  const committedSummary = deck.ownerUser.playerId
    ? await getDeckCommittedSummary(prisma, {
        deckId: deck.id,
        ownerPlayerId: deck.ownerUser.playerId,
      })
    : {
        deckLocation: null,
        committedEntries: 0,
        committedQuantity: 0,
        byCardId: {},
      };
  const sectionTotals = deckSectionQuantityTotals(deck.cards);
  const pricedCards = deck.cards
    .filter((deckCard) => deckCard.section !== DeckSection.MAYBEBOARD)
    .map((deckCard) => {
      const price = cardPriceNumber(deckCard.card?.prices);
      return price == null ? null : price * deckCard.quantity;
    })
    .filter((price): price is number => price !== null);
  const estimatedPrice = pricedCards.length
    ? pricedCards.reduce((total, price) => total + price, 0)
    : null;
  const manaValueCards = deck.cards.filter(
    (deckCard) =>
      deckCard.section !== DeckSection.MAYBEBOARD &&
      typeof deckCard.card?.manaValue === "number",
  );
  const averageManaValue = manaValueCards.length
    ? manaValueCards.reduce(
        (total, deckCard) =>
          total + (deckCard.card?.manaValue ?? 0) * deckCard.quantity,
        0,
      ) /
      manaValueCards.reduce((total, deckCard) => total + deckCard.quantity, 0)
    : null;
  const usesCommander =
    deck.format === DeckFormat.COMMANDER || sectionTotals.COMMANDER > 0;
  const editorRows = deck.cards.map((deckCard) => {
    const rowInventoryItems = candidatesForDeckCard(deckCard, inventoryMaps);
    const owned = summarizeDeckCardOwnership(
      deckCard,
      rowInventoryItems,
      deck.id,
    );
    const matchingItems = rowInventoryItems
      .map((item) => ({
        item,
        matchType: matchesDeckCardPrinting(deckCard, {
          id: item.id,
          cardId: item.cardId,
          quantity: item.quantity,
          card: item.card,
          location: item.location,
        }),
      }))
      .filter(
        (entry): entry is typeof entry & { matchType: "exact" | "other" } =>
          entry.matchType !== null,
      );
    const commitOptions = matchingItems
      .filter(({ item }) => !isDeckLocation(item.location))
      .map(({ item, matchType }) => ({
        inventoryItemId: item.id,
        locationName: item.location?.name ?? "Unassigned",
        quantity: item.quantity,
        cardName: item.card.name,
        setCode: item.card.setCode,
        collectorNumber: item.card.collectorNumber,
        matchType,
      }));
    const returnOptions = matchingItems
      .filter(({ item }) => item.location?.deckId === deck.id)
      .map(({ item }) => ({
        inventoryItemId: item.id,
        locationName: item.location?.name ?? "Deck",
        quantity: item.quantity,
        cardName: item.card.name,
        setCode: item.card.setCode,
        collectorNumber: item.card.collectorNumber,
      }));
    return {
      id: deckCard.id,
      cardName: deckCard.cardName,
      section: deckCard.section,
      quantity: deckCard.quantity,
      notes: deckCard.notes,
      isCommander: deckCard.isCommander,
      exactOwned: owned.exactOwned,
      otherOwned: owned.otherOwned,
      available: owned.available,
      availableExact: owned.availableExact,
      availableOther: owned.availableOther,
      committedToThisDeck: owned.committedToThisDeck,
      committedToOtherDecks: owned.committedToOtherDecks,
      commitmentMissing: owned.commitmentMissing,
      commitOptions,
      returnOptions,
      missing: owned.missing,
      isBasicLand: owned.isBasicLand,
      enoughOwned: owned.enoughOwned,
      matchType: owned.matchType,
      locationSummary: canEdit ? owned.locationSummary : "",
      committedQuantity: deckCard.cardId
        ? (committedSummary.byCardId[deckCard.cardId] ?? 0)
        : 0,
      createdAt: deckCard.createdAt.toISOString(),
      card: deckCard.card
        ? {
            id: deckCard.card.id,
            name: deckCard.card.name,
            manaCost: deckCard.card.manaCost,
            manaFaces: null,
            cardFaces: deckCard.card.cardFaces,
            layout: deckCard.card.layout,
            typeLine: deckCard.card.typeLine,
            setCode: deckCard.card.setCode,
            setName: deckCard.card.setName,
            collectorNumber: deckCard.card.collectorNumber,
            rarity: deckCard.card.rarity,
            prices: deckCard.card.prices,
            imageUri: deckCard.card.imageUri,
            imageUris: deckCard.card.imageUris,
            manaValue: deckCard.card.manaValue,
            colorIdentity: deckCard.card.colorIdentity,
            colors: deckCard.card.colors,
          }
        : null,
    };
  });
  const ownershipTotals = editorRows.reduce(
    (totals, row) => ({
      totalQuantity: totals.totalQuantity + row.quantity,
      exactOwned: totals.exactOwned + Math.min(row.quantity, row.exactOwned),
      otherOwned:
        totals.otherOwned +
        Math.min(
          Math.max(0, row.quantity - Math.min(row.quantity, row.exactOwned)),
          row.otherOwned,
        ),
      missing: totals.missing + row.missing,
    }),
    { totalQuantity: 0, exactOwned: 0, otherOwned: 0, missing: 0 },
  );

  const deckWishlistMissing = editorRows.reduce(
    (total, row) => total + row.missing,
    0,
  );
  const deckWishlistAvailable = editorRows.reduce(
    (total, row) => total + Math.min(row.missing, row.available),
    0,
  );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="app-panel overflow-hidden">
        <div className="border-b border-[#2a332d] bg-[#121915] px-4 py-3">
          <Link href="/decks" className="text-sm text-cyan-300">
            ← Decks
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            Deck builder
          </p>
          <h1 className="text-3xl font-bold text-stone-50">{deck.name}</h1>
          <p className="text-stone-400">
            {deckFormatLabel(deck.format)} · {formatDeckBracket(deck.bracket)} ·{" "}
            <ColorIdentitySymbols value={deckColorIdentity} /> ·{" "}
            {visibilityLabel(deck.visibility)} · Effective{" "}
            {effectiveVisibility.toLowerCase()}
          </p>
          {deck.description ? (
            <p className="max-w-3xl whitespace-pre-wrap text-stone-300">
              {deck.description}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Mainboard", sectionTotals.MAINBOARD],
            ["Commander", sectionTotals.COMMANDER],
            ["Sideboard", sectionTotals.SIDEBOARD],
            ["Maybeboard", sectionTotals.MAYBEBOARD],
            [
              "Est. value",
              estimatedPrice == null ? "--" : `$${estimatedPrice.toFixed(2)}`,
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-md border border-[#2a332d] bg-[#101614] px-3 py-2"
            >
              <p className="text-xs uppercase tracking-wide text-stone-500">
                {label}
              </p>
              <p className="text-base font-semibold text-stone-100">
                {String(value)}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-[#2a332d] p-2 md:grid-cols-4">
          {[
            ["Exact owned", ownershipTotals.exactOwned, "text-emerald-100"],
            ["Other owned", ownershipTotals.otherOwned, "text-cyan-100"],
            ["Missing", ownershipTotals.missing, "text-red-100"],
            ["Committed", committedSummary.committedQuantity, "text-amber-100"],
          ].map(([label, value, tone]) => (
            <div
              key={String(label)}
              className="rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2"
            >
              <p className="text-xs uppercase tracking-wide text-stone-500">
                {label}
              </p>
              <p className={cn("text-base font-semibold", String(tone))}>
                {String(value)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <DeckListEditor
        deckId={deck.id}
        rows={editorRows}
        sections={deckSections}
        canEdit={canEdit}
        defaultGroupMode={
          deck.format === DeckFormat.COMMANDER ? "type" : "section"
        }
        showPrivateInventory={canEdit}
        returnLocations={normalReturnLocations}
        actionControls={
          canEdit ? (
            <DeckActionPanels
              deckName={deck.name}
              committedQuantity={committedSummary.committedQuantity}
              canReturnCommitted={
                committedSummary.committedQuantity > 0 &&
                normalReturnLocations.length > 0
              }
              addCard={
                <DeckCardPicker
                  deckId={deck.id}
                  defaultSection={DeckSection.MAINBOARD}
                  sections={deckSections}
                />
              }
              pasteDecklist={<DeckImportPanel deckId={deck.id} />}
              returnCommitted={
                <form
                  action={returnAllCommittedDeckInventory}
                  id="return-committed"
                  className="space-y-3"
                >
                  <p className="text-sm text-zinc-300">
                    This affects physical committed inventory only. The deck
                    list stays intact. Currently physically in deck:{" "}
                    {committedSummary.committedQuantity} cards across{" "}
                    {committedSummary.committedEntries} inventory entries.
                  </p>
                  <input type="hidden" name="deckId" value={deck.id} />
                  <label className={cn(filterFieldClass, "block")}>
                    Destination normal inventory location
                    <select
                      name="destinationLocationId"
                      required
                      className={cn(filterSelectClass, "mt-1 w-full")}
                    >
                      <option value="">Choose a location…</option>
                      {normalReturnLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton
                    pendingLabel="Returning…"
                    disabled={
                      committedSummary.committedQuantity === 0 ||
                      normalReturnLocations.length === 0
                    }
                    className={cn(
                      filterPrimaryButtonClass,
                      "border-amber-700 text-amber-100 hover:bg-amber-950/40",
                    )}
                    confirmMessage="Return all physical cards from this deck location to the selected inventory location? The deck list will not be changed."
                  >
                    Return all committed cards
                  </SubmitButton>
                </form>
              }
              settings={
                <form
                  action={updateDeck}
                  className="space-y-3"
                  id="deck-settings"
                >
                  <input type="hidden" name="deckId" value={deck.id} />
                  <label className={cn(filterFieldClass, "block")}>
                    Name
                    <input
                      name="name"
                      defaultValue={deck.name}
                      required
                      className={cn(filterInputClass, "mt-1 w-full")}
                    />
                  </label>
                  <label className={cn(filterFieldClass, "block")}>
                    Description
                    <textarea
                      name="description"
                      defaultValue={deck.description ?? ""}
                      rows={3}
                      className={cn(filterTextareaClass, "mt-1 w-full")}
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className={filterFieldClass}>
                      Format
                      <select
                        name="format"
                        defaultValue={deck.format}
                        className={cn(filterSelectClass, "mt-1 w-full")}
                      >
                        {Object.values(DeckFormat).map((format) => (
                          <option key={format} value={format}>
                            {deckFormatLabel(format)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={filterFieldClass}>
                      Visibility
                      <select
                        name="visibility"
                        defaultValue={deck.visibility}
                        className={cn(filterSelectClass, "mt-1 w-full")}
                      >
                        {Object.values(Visibility).map((visibility) => (
                          <option key={visibility} value={visibility}>
                            {visibilityLabel(visibility)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={filterFieldClass}>
                      Bracket
                      <select
                        name="bracket"
                        defaultValue={deck.bracket ?? ""}
                        className={cn(filterSelectClass, "mt-1 w-full")}
                      >
                        {bracketSelectOptions().map((option) => (
                          <option
                            key={option.value || "unset"}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <SubmitButton
                    pendingLabel="Saving…"
                    className={filterPrimaryButtonClass}
                  >
                    Save deck settings
                  </SubmitButton>
                </form>
              }
              deleteDeck={
                <form
                  action={deleteDeck}
                  id="safe-delete"
                  className="space-y-3"
                >
                  <input type="hidden" name="deckId" value={deck.id} />
                  <p className="text-sm text-zinc-300">
                    Delete deck list “{deck.name}”.{" "}
                    {committedSummary.committedQuantity > 0
                      ? `This deck currently contains ${committedSummary.committedQuantity} committed physical cards in ${committedSummary.committedEntries} inventory entries. Choose a location to return them to before deletion.`
                      : "No committed physical inventory is currently in this deck location."}
                  </p>
                  {committedSummary.committedQuantity > 0 ? (
                    <>
                      <label className={cn(filterFieldClass, "block")}>
                        Destination normal inventory location
                        <select
                          name="destinationLocationId"
                          required
                          className={cn(filterSelectClass, "mt-1 w-full")}
                        >
                          <option value="">Choose a location…</option>
                          {normalReturnLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={cn(filterFieldClass, "block")}>
                        Type DELETE to confirm
                        <input
                          name="strongConfirmation"
                          className={cn(filterInputClass, "mt-1 w-full")}
                        />
                      </label>
                    </>
                  ) : null}
                  <SubmitButton
                    pendingLabel="Deleting…"
                    className={filterDangerButtonClass}
                    confirmMessage={
                      committedSummary.committedQuantity > 0
                        ? "Return committed physical cards to the selected location and delete this deck list? Inventory will not be deleted."
                        : `Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`
                    }
                  >
                    {committedSummary.committedQuantity > 0
                      ? "Return committed cards and delete deck"
                      : "Delete deck"}
                  </SubmitButton>
                </form>
              }
            />
          ) : null
        }
      />
    </main>
  );
}
