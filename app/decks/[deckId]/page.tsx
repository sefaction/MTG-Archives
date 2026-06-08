export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { CardManaCost, SetSymbol } from "@/components/mtg/CardSymbols";
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
import {
  deleteDeck,
  removeDeckCard,
  updateDeck,
  updateDeckCard,
} from "../actions";
import { DeckCardPicker } from "@/components/DeckCardPicker";
import { DeckImportPanel } from "@/components/DeckImportPanel";
import { DeckBulkActions } from "@/components/DeckBulkActions";

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
  const bulkRows = deck.cards.map((deckCard) => {
    const owned = summarizeDeckCardOwnership(deckCard, inventoryItems);
    return {
      id: deckCard.id,
      cardName: deckCard.cardName,
      section: deckCard.section,
      quantity: deckCard.quantity,
      exactOwned: owned.exactOwned,
      otherOwned: owned.otherOwned,
      missing: owned.missing,
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
            <DeckCardPicker
              deckId={deck.id}
              defaultSection={
                deck.format === DeckFormat.COMMANDER
                  ? DeckSection.COMMANDER
                  : DeckSection.MAINBOARD
              }
              sections={deckSections}
            />
            <DeckImportPanel deckId={deck.id} />
          </div>
        </section>
      ) : null}

      {canEdit ? <DeckBulkActions deckId={deck.id} rows={bulkRows} /> : null}

      <section className="space-y-6">
        {deckSections.map((section) => {
          const cards = deck.cards.filter((card) => card.section === section);
          if (
            cards.length === 0 &&
            section === DeckSection.COMMANDER &&
            deck.format !== DeckFormat.COMMANDER
          )
            return null;
          return (
            <div key={section} className="rounded border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 text-xl font-semibold">
                {deckSectionLabel(section)}
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-zinc-300">
                    <tr>
                      <th className="p-3">Qty</th>
                      <th className="p-3">Card</th>
                      <th className="p-3">Mana</th>
                      <th className="p-3">Set</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Owned</th>
                      <th className="p-3">Notes / Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((deckCard) => {
                      const owned = summarizeDeckCardOwnership(
                        deckCard,
                        inventoryItems,
                      );
                      return (
                        <tr
                          key={deckCard.id}
                          className="border-t border-zinc-800 align-top"
                        >
                          <td className="p-3 font-semibold">
                            {deckCard.quantity}
                          </td>
                          <td className="p-3">
                            {deckCard.cardName}
                            <div className="text-xs text-zinc-500">
                              {owned.matchType}
                            </div>
                          </td>
                          <td className="p-3">
                            {deckCard.card ? (
                              <CardManaCost card={deckCard.card} />
                            ) : (
                              <span className="text-zinc-500">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            {deckCard.card ? (
                              <SetSymbol
                                setCode={deckCard.card.setCode}
                                setName={deckCard.card.setName}
                                rarity={deckCard.card.rarity}
                              />
                            ) : (
                              <span className="text-zinc-500">Generic</span>
                            )}
                          </td>
                          <td className="p-3">
                            {deckCard.card?.typeLine ?? (
                              <span className="text-zinc-500">Unresolved</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span
                              className={
                                owned.enoughOwned
                                  ? "text-emerald-300"
                                  : "text-amber-200"
                              }
                            >
                              Owned exact printing: {owned.exactOwned} /{" "}
                              {deckCard.quantity}
                            </span>
                            <div>
                              {owned.otherOwned > 0
                                ? `Owned other printings: ${owned.otherOwned}`
                                : "No other printings owned"}
                            </div>
                            <div>
                              {owned.missing > 0
                                ? `Missing: ${owned.missing}`
                                : "Enough owned"}
                            </div>
                            {owned.locationSummary ? (
                              <div className="text-xs text-zinc-400">
                                Owned in {owned.locationSummary}
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3">
                            {canEdit ? (
                              <div className="space-y-2">
                                <form
                                  action={updateDeckCard}
                                  className="flex flex-wrap items-end gap-2"
                                >
                                  <input
                                    type="hidden"
                                    name="deckId"
                                    value={deck.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="deckCardId"
                                    value={deckCard.id}
                                  />
                                  <label className="text-xs">
                                    Qty
                                    <input
                                      name="quantity"
                                      type="number"
                                      min={1}
                                      defaultValue={deckCard.quantity}
                                      className="mt-1 w-20 border bg-zinc-900 p-1"
                                    />
                                  </label>
                                  <label className="text-xs">
                                    Section
                                    <select
                                      name="section"
                                      defaultValue={deckCard.section}
                                      className="mt-1 border bg-zinc-900 p-1"
                                    >
                                      {deckSections.map((s) => (
                                        <option key={s} value={s}>
                                          {deckSectionLabel(s)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs">
                                    Notes
                                    <input
                                      name="notes"
                                      defaultValue={deckCard.notes ?? ""}
                                      className="mt-1 border bg-zinc-900 p-1"
                                    />
                                  </label>
                                  <SubmitButton
                                    pendingLabel="Saving…"
                                    className="rounded border border-zinc-700 px-2 py-1"
                                    minWidthClassName="min-w-16"
                                  >
                                    Save
                                  </SubmitButton>
                                </form>
                                <form action={removeDeckCard}>
                                  <input
                                    type="hidden"
                                    name="deckId"
                                    value={deck.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="deckCardId"
                                    value={deckCard.id}
                                  />
                                  <SubmitButton
                                    pendingLabel="Removing…"
                                    className="rounded border border-red-800 px-2 py-1 text-red-200"
                                    minWidthClassName="min-w-20"
                                  >
                                    Remove
                                  </SubmitButton>
                                </form>
                              </div>
                            ) : (
                              (deckCard.notes ?? "")
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {cards.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-zinc-500">
                          No cards in this section.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
