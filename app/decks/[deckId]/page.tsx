export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import {
  canManageDeck,
  canViewDeck,
  deckFormatLabel,
  deckSectionLabel,
  deckSections,
  deckRowCount,
  deckSectionQuantityTotals,
  deckTotalQuantity,
  summarizeDeckCardOwnership,
  summarizeDeckOwnershipTotals,
} from "@/lib/decks";
import {
  getDeckCommittedSummary,
  isNormalInventoryLocation,
} from "@/lib/deck-inventory";
import { prisma } from "@/lib/prisma";
import { resolveDeckVisibility, visibilityLabel } from "@/lib/visibility";
import {
  deleteDeck,
  returnAllCommittedDeckInventory,
  updateDeck,
} from "../actions";
import { DeckCardPicker } from "@/components/DeckCardPicker";
import { DeckImportPanel } from "@/components/DeckImportPanel";
import {
  DeckListEditor,
  type DeckReturnLocation,
} from "@/components/DeckListEditor";

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
  const inventoryItems = user?.playerId
    ? await prisma.inventoryItem.findMany({
        where: { currentOwnerId: user.playerId, quantity: { gt: 0 } },
        include: { card: true, location: true },
      })
    : [];
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
  const ownershipTotals = summarizeDeckOwnershipTotals(
    deck.cards,
    inventoryItems,
  );
  const editorRows = deck.cards.map((deckCard) => {
    const owned = summarizeDeckCardOwnership(deckCard, inventoryItems);
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
          <a
            href="#safe-delete"
            className="rounded border border-red-800 px-3 py-2 text-red-200"
          >
            Delete deck
          </a>
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
                href="#return-committed"
                className="rounded border border-amber-700 px-3 py-2 text-amber-100"
              >
                Return all committed cards
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
        <div>
          <span className="text-zinc-400">Deck rows</span>
          <div className="text-xl font-semibold">
            {deckRowCount(deck.cards)}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Committed inventory</span>
          <div className="text-xl font-semibold text-amber-100">
            {committedSummary.committedQuantity}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Owned exact</span>
          <div className="text-xl font-semibold text-emerald-300">
            {ownershipTotals.exactOwned}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Missing</span>
          <div className="text-xl font-semibold text-amber-200">
            {ownershipTotals.missing}
          </div>
        </div>
        {deckSections.map((section) => (
          <div key={section}>
            <span className="text-zinc-400">
              {deckSectionLabel(section)} cards
            </span>
            <div className="font-semibold">{sectionTotals[section]}</div>
          </div>
        ))}
        <div>
          <span className="text-zinc-400">Owned other printing</span>
          <div className="font-semibold text-sky-200">
            {ownershipTotals.otherOwned}
          </div>
        </div>
      </section>

      {canEdit ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <form
            action={returnAllCommittedDeckInventory}
            id="return-committed"
            className="space-y-3 rounded border border-amber-900 bg-amber-950/10 p-4"
          >
            <h2 className="text-xl font-semibold">
              Return committed cards to inventory
            </h2>
            <p className="text-sm text-zinc-300">
              This affects physical committed inventory only. The deck list
              stays intact. Currently physically in deck:{" "}
              {committedSummary.committedQuantity} cards across{" "}
              {committedSummary.committedEntries} inventory entries.
            </p>
            <input type="hidden" name="deckId" value={deck.id} />
            <label className="block text-sm">
              Destination normal inventory location
              <select
                name="destinationLocationId"
                required
                className="mt-1 w-full border bg-zinc-900 p-2"
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
              className="rounded border border-amber-700 px-3 py-2 text-amber-100 disabled:opacity-60"
              confirmMessage="Return all physical cards from this deck location to the selected inventory location? The deck list will not be changed."
            >
              Return all committed cards
            </SubmitButton>
          </form>

          <form
            action={deleteDeck}
            id="safe-delete"
            className="space-y-3 rounded border border-red-900 bg-red-950/10 p-4"
          >
            <h2 className="text-xl font-semibold text-red-100">
              Safe deck deletion
            </h2>
            <input type="hidden" name="deckId" value={deck.id} />
            <p className="text-sm text-zinc-300">
              Delete deck list “{deck.name}”.{" "}
              {committedSummary.committedQuantity > 0
                ? `This deck currently contains ${committedSummary.committedQuantity} committed physical cards in ${committedSummary.committedEntries} inventory entries. Choose a location to return them to before deletion.`
                : "No committed physical inventory is currently in this deck location."}
            </p>
            {committedSummary.committedQuantity > 0 ? (
              <>
                <label className="block text-sm">
                  Destination normal inventory location
                  <select
                    name="destinationLocationId"
                    required
                    className="mt-1 w-full border bg-zinc-900 p-2"
                  >
                    <option value="">Choose a location…</option>
                    {normalReturnLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Type DELETE to confirm
                  <input
                    name="strongConfirmation"
                    className="mt-1 w-full border bg-zinc-900 p-2"
                  />
                </label>
              </>
            ) : null}
            <SubmitButton
              pendingLabel="Deleting…"
              className="rounded border border-red-800 px-3 py-2 text-red-200"
              confirmMessage={
                committedSummary.committedQuantity > 0
                  ? "Return committed physical cards to the selected location and delete this deck list? Inventory will not be deleted."
                  : `Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`
              }
            >
              {committedSummary.committedQuantity > 0
                ? `Return ${committedSummary.committedQuantity} cards and delete this deck`
                : "Delete deck"}
            </SubmitButton>
          </form>
        </section>
      ) : null}

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
        returnLocations={normalReturnLocations}
      />
    </main>
  );
}
