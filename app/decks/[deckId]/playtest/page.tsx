export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckToolsNav } from "@/components/DeckToolsNav";
import { Nav } from "@/components/Nav";
import { PlaytestSandbox } from "@/components/PlaytestSandbox";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { deckFormatLabel } from "@/lib/decks";
import { loadVisibleDeckSnapshot } from "@/lib/deck-snapshot";
import { effectiveVisibilityLabel } from "@/lib/visibility";

export default async function DeckPlaytestPage({
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

  return (
    <main className="space-y-3 p-4 md:p-6">
      <Nav />
      <section className="app-panel p-4">
        <Link href="/decks" className="text-sm text-[var(--app-link)]">
          &larr; Decks
        </Link>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
          Manual playtest
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-[var(--app-text)]">
              {deck.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--app-muted)]">
              {deckFormatLabel(deck.format)}
              {" · "}
              {deck.ownerDisplayName}
              {" · "}
              {effectiveVisibilityLabel(deck.effectiveVisibility)}
            </p>
          </div>
          <p className="max-w-xl text-xs text-[var(--app-muted)]">
            Goldfish with a manual tabletop. Cards, life, counters, and turns
            exist only in this browser session and never change the saved deck
            or inventory.
          </p>
        </div>
      </section>

      <DeckToolsNav deckId={deck.id} active="playtest" />
      <PlaytestSandbox cards={deck.cards} initialSeed={randomUUID()} />
    </main>
  );
}
