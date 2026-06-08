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
import {
  canManageDeck,
  canViewDeck,
  deckFormatLabel,
  deckSections,
  deckSectionQuantityTotals,
  deckTotalQuantity,
  summarizeDeckCardOwnership,
  summarizeDeckOwnershipTotals,
} from "@/lib/decks";
import { cardPriceNumber } from "@/lib/deck-view";
import { matchesDeckCardPrinting } from "@/lib/deck-commitments";
import { ensureDefaultLocation } from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";
import { resolveDeckVisibility, visibilityLabel } from "@/lib/visibility";
import { deleteDeck, updateDeck } from "../actions";
import { DeckCardPicker } from "@/components/DeckCardPicker";
import { DeckImportPanel } from "@/components/DeckImportPanel";
import { DeckListEditor } from "@/components/DeckListEditor";

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
        include: { card: true },
        orderBy: [{ section: "asc" }, { cardName: "asc" }],
      },
    },
  });
  if (!deck || !canViewDeck(user, deck, scope?.mode === "admin")) notFound();

  const canEdit = canManageDeck(user, deck, scope?.mode === "admin");
  const effectiveVisibility = resolveDeckVisibility(
    deck.ownerUser.deckDefaultVisibility,
    deck.visibility,
  );
  const inventoryOwnerId = canEdit ? deck.ownerUser.playerId : null;
  if (inventoryOwnerId) await ensureDefaultLocation(prisma, inventoryOwnerId);
  const inventoryItems = inventoryOwnerId
    ? await prisma.inventoryItem.findMany({
        where: { currentOwnerId: inventoryOwnerId, quantity: { gt: 0 } },
        include: { card: true, location: true },
      })
    : [];
  const normalLocations = inventoryOwnerId
    ? await prisma.inventoryLocation.findMany({
        where: {
          ownerPlayerId: inventoryOwnerId,
          kind: InventoryLocationKind.NORMAL,
          active: true,
        },
        orderBy: { name: "asc" },
      })
    : [];
  const sectionTotals = deckSectionQuantityTotals(deck.cards);
  const ownershipTotals = summarizeDeckOwnershipTotals(
    deck.cards,
    inventoryItems,
  );
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
    const owned = summarizeDeckCardOwnership(deckCard, inventoryItems, deck.id);
    return {
      id: deckCard.id,
      cardName: deckCard.cardName,
      section: deckCard.section,
      quantity: deckCard.quantity,
      notes: deckCard.notes,
      isCommander: deckCard.isCommander,
      exactOwned: owned.exactOwned,
      otherOwned: owned.otherOwned,
      missing: owned.missing,
      enoughOwned: owned.enoughOwned,
      matchType: owned.matchType,
      locationSummary: canEdit ? owned.locationSummary : "",
      available: owned.available,
      availableExact: owned.availableExact,
      availableOther: owned.availableOther,
      committedToThisDeck: owned.committedToThisDeck,
      committedToOtherDecks: owned.committedToOtherDecks,
      commitmentMissing: owned.commitmentMissing,
      commitOptions: canEdit
        ? inventoryItems
            .filter(
              (item) =>
                item.location?.kind !== InventoryLocationKind.DECK &&
                Boolean(matchesDeckCardPrinting(deckCard, item)),
            )
            .map((item) => ({
              inventoryItemId: item.id,
              quantity: item.quantity,
              cardName: item.card.name,
              setCode: item.card.setCode,
              collectorNumber: item.card.collectorNumber,
              locationName: item.location?.name ?? "Unassigned",
              matchType: matchesDeckCardPrinting(deckCard, item) ?? "other",
            }))
            .sort((left, right) => {
              if (left.matchType !== right.matchType)
                return left.matchType === "exact" ? -1 : 1;
              return left.locationName.localeCompare(right.locationName);
            })
        : [],
      returnOptions: canEdit
        ? inventoryItems
            .filter(
              (item) =>
                item.location?.deckId === deck.id &&
                Boolean(matchesDeckCardPrinting(deckCard, item)),
            )
            .map((item) => ({
              inventoryItemId: item.id,
              quantity: item.quantity,
              cardName: item.card.name,
              setCode: item.card.setCode,
              collectorNumber: item.card.collectorNumber,
              locationName: item.location?.name ?? "Deck location",
              matchType: matchesDeckCardPrinting(deckCard, item) ?? "other",
            }))
        : [],
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
  const deckWishlistMissing = editorRows.reduce(
    (total, row) => total + row.commitmentMissing,
    0,
  );
  const deckWishlistAvailable = editorRows.reduce(
    (total, row) => total + Math.min(row.commitmentMissing, row.available),
    0,
  );

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <section className="space-y-2">
          <Link href="/decks" className="text-sm text-sky-200">
            ← Decks
          </Link>
          <h1 className="text-3xl font-bold">{deck.name}</h1>
          <p className="text-zinc-400">
            {deckFormatLabel(deck.format)} · {visibilityLabel(deck.visibility)}{" "}
            · Effective {effectiveVisibility.toLowerCase()}
          </p>
          {deck.description ? (
            <p className="max-w-3xl whitespace-pre-wrap text-zinc-300">
              {deck.description}
            </p>
          ) : null}
        </section>
        {canEdit ? (
          <form action={deleteDeck}>
            <input type="hidden" name="deckId" value={deck.id} />
            <SubmitButton
              pendingLabel="Deleting…"
              className="rounded border border-red-800 px-3 py-2 text-red-200"
              confirmMessage={`Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`}
            >
              Delete deck
            </SubmitButton>
          </form>
        ) : null}
      </div>

      <section
        className="rounded border border-zinc-800 bg-zinc-950/80 p-4"
        aria-label="Deck toolbar"
      >
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <a
                href="#add-card"
                className="rounded border border-sky-700 px-3 py-2 text-sky-100"
              >
                Add card
              </a>
              <a
                href="#paste-decklist"
                className="rounded border border-zinc-700 px-3 py-2"
              >
                Paste decklist
              </a>
              <a
                href="#bulk-edit"
                className="rounded border border-zinc-700 px-3 py-2"
              >
                Bulk edit
              </a>
              <a
                href="#bulk-edit"
                className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
              >
                Optimize printings
              </a>
              <button
                type="button"
                disabled
                className="rounded border border-zinc-800 px-3 py-2 text-zinc-500"
                title="Export is coming later"
              >
                Export · coming later
              </button>
              <a
                href="#deck-settings"
                className="rounded border border-zinc-700 px-3 py-2"
              >
                Deck settings
              </a>
            </>
          ) : (
            <span className="rounded border border-zinc-800 px-3 py-2 text-zinc-400">
              Public read-only deck browser
            </span>
          )}
        </div>
      </section>

      <section className="grid gap-3 rounded border border-zinc-800 p-4 text-sm md:grid-cols-4">
        <div>
          <span className="text-zinc-400">Total cards</span>
          <div className="text-xl font-semibold">
            {deckTotalQuantity(deck.cards)}
          </div>
        </div>
        {usesCommander ? (
          <div>
            <span className="text-zinc-400">Commander</span>
            <div className="text-xl font-semibold">
              {sectionTotals.COMMANDER}
            </div>
          </div>
        ) : null}
        <div>
          <span className="text-zinc-400">Mainboard</span>
          <div className="text-xl font-semibold">{sectionTotals.MAINBOARD}</div>
        </div>
        {sectionTotals.SIDEBOARD > 0 ? (
          <div>
            <span className="text-zinc-400">Sideboard</span>
            <div className="text-xl font-semibold">
              {sectionTotals.SIDEBOARD}
            </div>
          </div>
        ) : null}
        {sectionTotals.MAYBEBOARD > 0 ? (
          <div>
            <span className="text-zinc-400">Maybeboard</span>
            <div className="text-xl font-semibold">
              {sectionTotals.MAYBEBOARD}
            </div>
          </div>
        ) : null}
        <div>
          <span className="text-zinc-400">Missing cards</span>
          <div className="text-xl font-semibold text-amber-200">
            {ownershipTotals.missing}
          </div>
        </div>
        {canEdit ? (
          <div>
            <span className="text-zinc-400">Wishlist needs</span>
            <div className="text-xl font-semibold text-amber-200">
              <Link href="/wishlist?tab=decks">
                {deckWishlistMissing} needed
              </Link>
            </div>
            <div className="text-xs text-emerald-300">
              {deckWishlistAvailable} available to commit
            </div>
          </div>
        ) : null}
        <div>
          <span className="text-zinc-400">Owned exact</span>
          <div className="font-semibold text-emerald-300">
            {ownershipTotals.exactOwned}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Owned other printing</span>
          <div className="font-semibold text-sky-200">
            {ownershipTotals.otherOwned}
          </div>
        </div>
        {estimatedPrice != null ? (
          <div>
            <span className="text-zinc-400">Estimated price</span>
            <div className="font-semibold">${estimatedPrice.toFixed(2)}</div>
          </div>
        ) : null}
        {averageManaValue != null ? (
          <div>
            <span className="text-zinc-400">Average mana value</span>
            <div className="font-semibold">{averageManaValue.toFixed(2)}</div>
          </div>
        ) : null}
      </section>

      {canEdit ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <form
            action={updateDeck}
            className="space-y-3 rounded border border-zinc-800 p-4"
            id="deck-settings"
          >
            <h2 className="text-xl font-semibold">Deck settings</h2>
            <input type="hidden" name="deckId" value={deck.id} />
            <label className="block text-sm">
              Name
              <input
                name="name"
                defaultValue={deck.name}
                required
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="block text-sm">
              Description
              <textarea
                name="description"
                defaultValue={deck.description ?? ""}
                rows={3}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Format
                <select
                  name="format"
                  defaultValue={deck.format}
                  className="mt-1 w-full border bg-zinc-900 p-2"
                >
                  {Object.values(DeckFormat).map((format) => (
                    <option key={format} value={format}>
                      {deckFormatLabel(format)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Visibility
                <select
                  name="visibility"
                  defaultValue={deck.visibility}
                  className="mt-1 w-full border bg-zinc-900 p-2"
                >
                  {Object.values(Visibility).map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {visibilityLabel(visibility)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SubmitButton
              pendingLabel="Saving…"
              className="rounded border border-sky-700 px-3 py-2 text-sky-100"
            >
              Save deck settings
            </SubmitButton>
          </form>

          <div className="space-y-4">
            <div id="add-card">
              <DeckCardPicker
                deckId={deck.id}
                defaultSection={
                  deck.format === DeckFormat.COMMANDER
                    ? DeckSection.COMMANDER
                    : DeckSection.MAINBOARD
                }
                sections={deckSections}
              />
            </div>
            <div id="paste-decklist">
              <DeckImportPanel deckId={deck.id} />
            </div>
          </div>
        </section>
      ) : null}

      <DeckListEditor
        deckId={deck.id}
        rows={editorRows}
        sections={deckSections}
        canEdit={canEdit}
        defaultGroupMode={
          deck.format === DeckFormat.COMMANDER ? "type" : "section"
        }
        showPrivateInventory={canEdit}
        normalLocations={normalLocations.map((location) => ({
          id: location.id,
          name: location.name,
        }))}
      />
    </main>
  );
}
