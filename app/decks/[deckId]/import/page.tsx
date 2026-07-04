export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { DeckImportPanel } from "@/components/DeckImportPanel";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { canManageDeck, deckFormatLabel } from "@/lib/decks";
import { prisma } from "@/lib/prisma";

export default async function DeckImportPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const user = await getCurrentUser();
  const scope = user ? await getAccessScope(user) : null;
  const { deckId } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { ownerUser: true },
  });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    notFound();
  }

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="app-panel overflow-hidden">
        <div className="border-b border-[#2a332d] bg-[#121915] px-4 py-3">
          <Link href={`/decks/${deck.id}`} className="text-sm text-cyan-300">
            Back to deck
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            Deck import
          </p>
          <h1 className="text-3xl font-bold text-stone-50">{deck.name}</h1>
          <p className="text-stone-400">{deckFormatLabel(deck.format)}</p>
        </div>
        <div className="p-4">
          <DeckImportPanel deckId={deck.id} />
        </div>
      </section>
    </main>
  );
}
