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
  const inventoryItems = user?.playerId
    ? await prisma.inventoryItem.findMany({
        where: { currentOwnerId: user.playerId, quantity: { gt: 0 } },
        include: { card: true, location: true },
      })
    : [];
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
        <div>
          <span className="text-zinc-400">Deck rows</span>
          <div className="text-xl font-semibold">
            {deckRowCount(deck.cards)}
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
      />
    </main>
  );
}
