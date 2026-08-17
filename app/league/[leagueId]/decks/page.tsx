export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueNav } from "@/components/league/LeagueNav";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLeagueDeck } from "../../actions";

export default async function LeagueDecksPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const { leagueId } = await params;
  const query = await searchParams;
  const league = await prisma.commanderLeague.findFirst({
    where: {
      id: leagueId,
      members: { some: { userId: user.id, active: true } },
    },
    include: {
      rounds: { orderBy: { monthNumber: "asc" } },
      members: {
        where: { active: true },
        include: {
          user: true,
          decks: {
            include: { archiveDeck: { include: { cards: true } }, round: true },
            orderBy: { round: { monthNumber: "asc" } },
          },
        },
        orderBy: { user: { displayName: "asc" } },
      },
    },
  });
  if (!league) notFound();
  const myMembership = league.members.find(
    (member) => member.userId === user.id,
  )!;
  const canAssignPlayers = myMembership.role === "ADMIN";
  const deckCount = league.members.reduce(
    (sum, member) => sum + member.decks.length,
    0,
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <LeagueNav leagueId={league.id} />
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
          {league.name}
        </p>
        <h1 className="text-4xl font-bold">League Decks</h1>
        <p className="app-muted mt-2 max-w-3xl">
          Build decks exclusively for this league. These lists stay separate
          from MTG Archives decks and inventory commitments; submitting one to a
          game freezes its current card list.
        </p>
      </header>
      {query.error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-red-100">
          {query.error}
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <div className="app-panel p-5">
          <h2 className="text-2xl font-semibold">Create submitted deck</h2>
          <form action={createLeagueDeck} className="mt-4 space-y-3">
            <input type="hidden" name="leagueId" value={league.id} />
            <label className="block text-sm">
              <span className="app-muted mb-1 block">Player</span>
              <select
                name="memberId"
                defaultValue={myMembership.id}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              >
                {(canAssignPlayers ? league.members : [myMembership]).map(
                  (member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.displayName}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="block text-sm">
              <span className="app-muted mb-1 block">Submission month</span>
              <select
                name="roundId"
                required
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              >
                {league.rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.name} {league.year}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="app-muted mb-1 block">Deck name</span>
              <input
                name="name"
                required
                maxLength={120}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="app-muted mb-1 block">Description</span>
              <textarea
                name="description"
                maxLength={500}
                rows={3}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              />
            </label>
            <button className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-600">
              Create league deck
            </button>
          </form>
        </div>

        <div className="app-panel p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">League deck library</h2>
              <p className="app-muted text-sm">
                {deckCount} decks across {league.members.length} players
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {league.members.flatMap((member) =>
              member.decks.map((deck) => {
                const cardCount = deck.archiveDeck.cards.reduce(
                  (sum, card) => sum + card.quantity,
                  0,
                );
                const commanders = deck.archiveDeck.cards
                  .filter((card) => card.isCommander)
                  .map((card) => card.cardName);
                return (
                  <Link
                    key={deck.id}
                    href={`/league/${league.id}/decks/${deck.id}`}
                    className="rounded border border-zinc-800 p-4 hover:border-cyan-700"
                  >
                    <p className="app-muted text-xs uppercase tracking-wide">
                      {deck.round.name} · {member.user.displayName}
                      {member.id === myMembership.id ? " · Yours" : ""}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">
                      {deck.archiveDeck.name}
                    </h3>
                    <p className="app-muted mt-2 text-sm">
                      {cardCount} cards
                      {commanders.length
                        ? ` · ${commanders.join(" + ")}`
                        : " · No commander selected"}
                    </p>
                  </Link>
                );
              }),
            )}
            {!deckCount ? (
              <p className="app-muted text-sm">
                No league decks have been built yet.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
