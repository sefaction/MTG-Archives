export const dynamic = "force-dynamic";

import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { CardHunt } from "@/components/CardHunt";

export default async function CardHuntPage({searchParams}: {
  searchParams: Promise<{deckId?: string}>;
}) {
  const user = await requireLogin();
  const query = await searchParams;
  const decks = await prisma.deck.findMany({where: {ownerUserId: user.id, commanderLeagueDeck: null},
    orderBy: [{name: "asc"}, {id: "asc"}], select: {id: true, name: true}});
  return <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
    <Nav />
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">Card Hunt</h1>
      <p className="mt-2 text-sm text-[var(--app-muted)]">Find the boxes and sections to pull your cards from.</p>
    </div>
    {user.playerId ? <CardHunt decks={decks} initialDeckId={decks.some(deck => deck.id === query.deckId) ? query.deckId : undefined} /> :
      <p className="app-panel p-4">Link your account to an inventory owner in Settings to hunt cards.</p>}
  </main>;
}
