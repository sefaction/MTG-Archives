export const dynamic = "force-dynamic";

import Link from "next/link";
import { DeckFormat, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deckFormatLabel, deckSectionSummaryParts } from "@/lib/decks";
import { visibilityLabel } from "@/lib/visibility";
import { createDeck, deleteDeck } from "./actions";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";

export default async function DecksPage() {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const adminModeActive = scope?.mode === "admin";
  const decks = await prisma.deck.findMany({
    where: adminModeActive ? {} : { ownerUserId: user.id },
    include: {
      cards: { select: { quantity: true, section: true } },
      ownerUser: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Decks</h1>
        <p className="text-zinc-400">
          Create deck lists independently from inventory while still seeing
          owned and missing card counts.
        </p>
        {adminModeActive ? (
          <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
            Admin mode is active. This index includes decks across users.
          </p>
        ) : null}
      </section>

      <form
        action={createDeck}
        className="grid gap-3 rounded border border-zinc-800 p-4 md:grid-cols-5"
      >
        <label className={cn(filterFieldClass, "md:col-span-2")}>
          Deck name
          <input
            name="name"
            required
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={filterFieldClass}>
          Format
          <select
            name="format"
            defaultValue={DeckFormat.CASUAL}
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
            defaultValue={Visibility.INHERIT}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            {Object.values(Visibility).map((visibility) => (
              <option key={visibility} value={visibility}>
                {visibilityLabel(visibility)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <SubmitButton
            pendingLabel="Creating…"
            className={cn(filterPrimaryButtonClass, "w-full")}
          >
            Create deck
          </SubmitButton>
        </div>
        <label className={cn(filterFieldClass, "md:col-span-5")}>
          Description
          <textarea
            name="description"
            rows={2}
            className={cn(filterTextareaClass, "mt-1 w-full")}
          />
        </label>
      </form>

      <section className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-300">
            <tr>
              <th className="p-3">Deck</th>
              {adminModeActive ? <th className="p-3">Owner</th> : null}
              <th className="p-3">Format</th>
              <th className="p-3">Visibility</th>
              <th className="p-3">Cards</th>
              <th className="p-3">Updated</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {decks.map((deck) => (
              <tr key={deck.id} className="border-t border-zinc-800">
                <td className="p-3 font-medium text-sky-100">
                  <Link href={`/decks/${deck.id}`}>{deck.name}</Link>
                </td>
                {adminModeActive ? (
                  <td className="p-3">{deck.ownerUser.displayName}</td>
                ) : null}
                <td className="p-3">{deckFormatLabel(deck.format)}</td>
                <td className="p-3">{visibilityLabel(deck.visibility)}</td>
                <td className="p-3">
                  {deckSectionSummaryParts(deck.cards).join(" · ")}
                </td>
                <td className="p-3">{deck.updatedAt.toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className="rounded border border-zinc-700 px-2 py-1"
                      href={`/decks/${deck.id}`}
                    >
                      View/Edit
                    </Link>
                    <form action={deleteDeck}>
                      <input type="hidden" name="deckId" value={deck.id} />
                      <SubmitButton
                        pendingLabel="Deleting…"
                        className="rounded border border-red-800 px-2 py-1 text-red-200"
                        confirmMessage={`Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`}
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {decks.length === 0 ? (
              <tr>
                <td
                  className="p-6 text-zinc-400"
                  colSpan={adminModeActive ? 8 : 7}
                >
                  No decks yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
