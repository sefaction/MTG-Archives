export const dynamic = "force-dynamic";

import { createHash, randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckToolsNav } from "@/components/DeckToolsNav";
import { Nav } from "@/components/Nav";
import { PlaytestSandbox } from "@/components/PlaytestSandbox";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { deckFormatLabel } from "@/lib/decks";
import { loadVisibleDeckSnapshot } from "@/lib/deck-snapshot";
import { effectiveVisibilityLabel } from "@/lib/visibility";
import { playtestStorageKey } from "@/lib/playtest-storage";
import { MAX_PLAYTEST_CARDS } from "@/lib/playtest";

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
    <main className="deck-builder-page min-w-0 space-y-3 p-3 md:p-6">
      <Nav />
      <section className="app-panel p-3">
        <Link
          href={`/decks/${deck.id}`}
          className="text-sm text-[var(--app-link)]"
        >
          &larr; Back to deck
        </Link>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
          Manual playtest
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="break-words text-2xl font-bold text-[var(--app-text)]">
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
            stay on this device and never change the saved deck or inventory.
          </p>
        </div>
      </section>

      <DeckToolsNav deckId={deck.id} active="playtest" />
      {deck.cards
        .filter((card) => card.section !== "MAYBEBOARD" || card.isCommander)
        .reduce((sum, card) => sum + card.quantity, 0) > MAX_PLAYTEST_CARDS ? (
        <p role="alert">
          This deck exceeds the {MAX_PLAYTEST_CARDS}-card playtest limit. Reduce
          its size before starting.
        </p>
      ) : (
        <PlaytestSandbox
          cards={deck.cards}
          key={createHash("sha256")
            .update(
              JSON.stringify({
                viewer: user?.id ?? "anonymous",
                deck: deck.id,
                cards: deck.cards,
              }),
            )
            .digest("hex")}
          initialSeed={randomUUID()}
          storageKey={playtestStorageKey(user?.id ?? "anonymous", deck.id)}
        />
      )}
    </main>
  );
}
