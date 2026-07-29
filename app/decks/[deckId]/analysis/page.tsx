export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { DeckToolsNav } from "@/components/DeckToolsNav";
import { ManaCurveAnalysis } from "@/components/ManaCurveAnalysis";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { deckFormatLabel } from "@/lib/decks";
import { loadVisibleDeckSnapshot } from "@/lib/deck-snapshot";
import { effectiveVisibilityLabel } from "@/lib/visibility";

export default async function DeckAnalysisPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const user = await getCurrentUser();
  const scope = user ? await getAccessScope(user) : null;
  const { deckId } = await params;
  const deck = await loadVisibleDeckSnapshot(
    deckId,
    user,
    scope?.mode === "admin",
  );
  if (!deck) notFound();

  const hasCommanders = deck.cards.some(
    (card) => card.section === "COMMANDER" || card.isCommander,
  );

  return (
    <main className="space-y-5 p-4 md:p-8">
      <Nav />
      <section className="app-panel p-5">
        <Link href="/decks" className="text-sm text-cyan-300">
          ← Decks
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-200">
          Deck analysis
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-stone-50">{deck.name}</h1>
            <p className="mt-1 text-sm text-stone-400">
              {deckFormatLabel(deck.format)} · {deck.ownerDisplayName} ·{" "}
              {effectiveVisibilityLabel(deck.effectiveVisibility)}
            </p>
          </div>
          <p className="max-w-xl text-sm text-stone-400">
            Quantity-aware curve statistics from the mainboard
            {hasCommanders ? " and commander" : ""}. Sideboard and maybeboard
            cards are excluded.
          </p>
        </div>
      </section>

      <DeckToolsNav deckId={deck.id} active="analysis" />
      <ManaCurveAnalysis cards={deck.cards} hasCommanders={hasCommanders} />
    </main>
  );
}
