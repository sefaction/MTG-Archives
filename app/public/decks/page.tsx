import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  deckFormatLabel,
  deckRowCount,
  deckTotalQuantity,
  publicDeckWhere,
} from "@/lib/decks";

export const dynamic = "force-dynamic";

export default async function PublicDecksPage() {
  const decks = await prisma.deck.findMany({
    where: publicDeckWhere(),
    include: {
      cards: { select: { quantity: true, section: true } },
      ownerUser: {
        select: {
          publicSlug: true,
          publicDisplayName: true,
          displayName: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return (
    <main className="p-8 space-y-6">
      <nav className="flex flex-wrap gap-4 border-b border-zinc-800 pb-4 text-sm">
        <Link href="/public" className="font-bold text-sky-200">
          Public collections
        </Link>
        <Link href="/public/inventory">Public inventory</Link>
        <Link href="/public/decks">Public decks</Link>
        <Link href="/login">Log in</Link>
      </nav>
      <section className="space-y-3">
        <h1 className="text-3xl font-bold">Public decks</h1>
        <p className="text-zinc-400">
          Read-only public deck browsing. Private decks are excluded.
        </p>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {decks.map((deck) => (
          <Link
            key={deck.id}
            href={`/decks/${deck.id}`}
            className="rounded border border-zinc-800 p-4 hover:border-sky-800"
          >
            <h2 className="text-xl font-semibold text-sky-100">{deck.name}</h2>
            <p className="text-sm text-zinc-400">
              By{" "}
              {deck.ownerUser.publicDisplayName || deck.ownerUser.displayName}
            </p>
            <p className="text-sm">
              {deckFormatLabel(deck.format)} · {deckTotalQuantity(deck.cards)}{" "}
              cards · {deckRowCount(deck.cards)} rows
            </p>
          </Link>
        ))}
        {decks.length === 0 ? (
          <p className="rounded border border-zinc-800 p-4 text-zinc-400">
            No public decks yet.
          </p>
        ) : null}
      </div>
    </main>
  );
}
