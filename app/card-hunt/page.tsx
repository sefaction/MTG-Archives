export const dynamic = "force-dynamic";

import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { CardHunt } from "@/components/CardHunt";
import { deckToolHref } from "@/components/DeckToolsNav";
import Link from "next/link";

export default async function CardHuntPage({searchParams}: {
  searchParams: Promise<{deckId?: string; from?: string}>;
}) {
  const user = await requireLogin();
  const query = await searchParams;
  const decks = await prisma.deck.findMany({where: {ownerUserId: user.id, commanderLeagueDeck: null},
    orderBy: [{name: "asc"}, {id: "asc"}], select: {id: true, name: true}});
  const initialDeckId = decks.find((deck) => deck.id === query.deckId)?.id;
  return <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
    <Nav deckHunt={Boolean(initialDeckId && user.playerId)} />
    <div className="mb-6">
      {initialDeckId && user.playerId && (
        <Link href={deckToolHref(initialDeckId, query.from)} className="mb-2 inline-block text-sm underline">Back to deck</Link>
      )}
      <h1 className="text-2xl font-semibold">Card Hunt</h1>
      <p className="mt-2 text-sm text-[var(--app-muted)]">Find the boxes and sections to pull your cards from.</p>
    </div>
    {user.playerId ? <CardHunt key={initialDeckId} decks={decks} initialDeckId={initialDeckId} /> :
      <p className="app-panel p-4">Link your account to an inventory owner in Settings to hunt cards.</p>}
  </main>;
}
