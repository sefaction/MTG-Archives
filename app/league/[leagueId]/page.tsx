export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
import { GameEntryForm } from "@/components/league/GameEntryForm";
import { LeagueNav } from "@/components/league/LeagueNav";
import { requireLogin } from "@/lib/auth";
import {
  buildLeagueCardStats,
  buildLeagueStandings,
} from "@/lib/commander-league";
import { prisma } from "@/lib/prisma";
import {
  addLeagueLocation,
  addLeagueMember,
  createLeagueGame,
  removeLeagueLocation,
} from "../actions";

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export default async function CommanderLeagueDashboard({
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
      members: {
        where: { active: true },
        include: {
          user: {
            include: { player: true },
          },
          decks: {
            include: { archiveDeck: { select: { name: true } } },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { user: { displayName: "asc" } },
      },
      rounds: { orderBy: { monthNumber: "asc" } },
      locations: {
        include: {
          location: {
            include: {
              inventoryItems: {
                where: { quantity: { gt: 0 } },
                select: { quantity: true },
              },
              ownerPlayer: {
                include: { users: { where: { isActive: true } } },
              },
            },
          },
        },
        orderBy: { addedAt: "asc" },
      },
      games: {
        orderBy: { playedAt: "desc" },
        include: {
          round: true,
          participants: {
            include: {
              member: { include: { user: true } },
              deckSubmission: { include: { cards: true } },
            },
          },
        },
      },
    },
  });
  if (!league) notFound();

  const isAdmin = league.members.some(
    (member) => member.userId === user.id && member.role === "ADMIN",
  );
  const existingUserIds = league.members.map((member) => member.userId);
  const availableUsers = isAdmin
    ? await prisma.user.findMany({
        where: {
          isActive: true,
          playerId: { not: null },
          id: { notIn: existingUserIds },
        },
        orderBy: { displayName: "asc" },
      })
    : [];
  const linkedLocationIds = new Set(
    league.locations.map((entry) => entry.locationId),
  );
  const availableLocations = league.members.flatMap((member) => {
    const playerId = member.user.playerId;
    if (!playerId) return [];
    return [] as { id: string; name: string; ownerName: string }[];
  });
  if (isAdmin) {
    const memberLocations = await prisma.user.findMany({
      where: { id: { in: existingUserIds }, playerId: { not: null } },
      include: {
        player: {
          include: {
            inventoryLocations: {
              where: { active: true, kind: "NORMAL" },
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });
    for (const member of memberLocations) {
      for (const location of member.player?.inventoryLocations || []) {
        const isPublic =
          location.visibility === Visibility.PUBLIC ||
          (location.visibility === Visibility.INHERIT &&
            member.inventoryDefaultVisibility ===
              DefaultCollectionVisibility.PUBLIC);
        if (isPublic && !linkedLocationIds.has(location.id)) {
          availableLocations.push({
            id: location.id,
            name: location.name,
            ownerName: member.displayName,
          });
        }
      }
    }
  }

  const standings = buildLeagueStandings(
    league.games.flatMap((game) =>
      game.participants.map((participant) => ({
        memberId: participant.memberId,
        displayName: participant.member.user.displayName,
        result: participant.result,
        pointsAwarded: participant.pointsAwarded,
        finishPosition: participant.finishPosition,
        participantCount: game.participants.length,
      })),
    ),
  );
  const snapshotCards = league.games.flatMap((game) =>
    game.participants.flatMap((participant) =>
      (participant.deckSubmission?.cards || []).map((card) => ({
        cardName: card.cardName,
        oracleId: card.oracleId,
        quantity: card.quantity,
        isCommander: card.isCommander,
      })),
    ),
  );
  const cardStats = buildLeagueCardStats(snapshotCards);
  const locationCardCount = league.locations.reduce(
    (total, entry) =>
      total +
      entry.location.inventoryItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
    0,
  );
  const gameMembers = league.members.map((member) => ({
    id: member.id,
    name: member.user.displayName,
    decks: member.decks.map((deck) => ({
      id: deck.id,
      name: deck.archiveDeck.name,
      roundId: deck.roundId,
    })),
  }));

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <LeagueNav leagueId={league.id} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
            {league.year} Commander League
          </p>
          <h1 className="text-4xl font-bold">{league.name}</h1>
          {league.description ? (
            <p className="app-muted mt-2 max-w-3xl">{league.description}</p>
          ) : null}
        </div>
        <div className="rounded border border-zinc-800 px-4 py-3 text-sm">
          <p>
            <strong>{league.winPoints}</strong> win ·{" "}
            <strong>{league.drawPoints}</strong> draw ·{" "}
            <strong>{league.lossPoints}</strong> loss
          </p>
          <p className="app-muted">Tiebreak: cumulative elimination finish</p>
        </div>
      </header>
      {query.error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-red-100">
          {query.error}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Players", league.members.length],
          ["Games", league.games.length],
          [
            "Frozen decks",
            league.games.reduce(
              (sum, game) =>
                sum +
                game.participants.filter((item) => item.deckSubmission).length,
              0,
            ),
          ],
          ["Unique cards used", cardStats.uniqueCards],
          ["League inventory", locationCardCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="app-card p-4">
            <p className="app-muted text-sm">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="app-panel overflow-hidden">
          <div className="border-b border-zinc-800 p-4">
            <h2 className="text-2xl font-semibold">Standings</h2>
            <p className="app-muted text-sm">
              Points first; elimination finish score breaks ties.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="p-3 text-left">Rank</th>
                  <th className="p-3 text-left">Player</th>
                  <th className="p-3 text-right">GP</th>
                  <th className="p-3 text-right">W</th>
                  <th className="p-3 text-right">L</th>
                  <th className="p-3 text-right">D</th>
                  <th className="p-3 text-right">Finish</th>
                  <th className="p-3 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, index) => (
                  <tr key={row.memberId}>
                    <td className="p-3">{index + 1}</td>
                    <td className="p-3 font-medium">{row.displayName}</td>
                    <td className="p-3 text-right">{row.games}</td>
                    <td className="p-3 text-right">{row.wins}</td>
                    <td className="p-3 text-right">{row.losses}</td>
                    <td className="p-3 text-right">{row.draws}</td>
                    <td className="p-3 text-right">{row.finishScore}</td>
                    <td className="p-3 text-right font-bold">{row.points}</td>
                  </tr>
                ))}
                {!standings.length ? (
                  <tr>
                    <td colSpan={8} className="p-5 text-center app-muted">
                      Record the first game to create standings.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="app-panel p-4">
          <h2 className="text-2xl font-semibold">Monthly rounds</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {league.rounds.map((round) => {
              const count = league.games.filter(
                (game) => game.roundId === round.id,
              ).length;
              return (
                <div
                  key={round.id}
                  className="rounded border border-zinc-800 p-3"
                >
                  <p className="font-medium">{round.name.slice(0, 3)}</p>
                  <p className="app-muted text-xs">
                    {count} {count === 1 ? "game" : "games"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {isAdmin ? (
        <section className="app-panel p-5">
          <h2 className="text-2xl font-semibold">Record a completed game</h2>
          <p className="app-muted mb-4 text-sm">
            Select decks built in the League Decks tab. Each list is copied into
            an immutable snapshot for this game; no inventory is committed or
            moved.
          </p>
          <GameEntryForm
            leagueId={league.id}
            members={gameMembers}
            rounds={league.rounds.map((round) => ({
              id: round.id,
              name: round.name,
              monthNumber: round.monthNumber,
            }))}
            action={createLeagueGame}
          />
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="app-panel p-5">
          <h2 className="text-2xl font-semibold">Most-played cards</h2>
          <div className="mt-3 space-y-2">
            {cardStats.topCards.map((card) => (
              <div
                key={`${card.cardName}-${card.appearances}`}
                className="flex justify-between border-b border-zinc-800 pb-2"
              >
                <span>{card.cardName}</span>
                <span className="app-muted text-sm">
                  {card.appearances} decks · {card.copies} copies
                </span>
              </div>
            ))}
            {!cardStats.topCards.length ? (
              <p className="app-muted text-sm">
                Card statistics appear after deck submissions.
              </p>
            ) : null}
          </div>
        </div>
        <div className="app-panel p-5">
          <h2 className="text-2xl font-semibold">Commanders</h2>
          <div className="mt-3 space-y-2">
            {cardStats.commanders.map((card) => (
              <div
                key={card.cardName}
                className="flex justify-between border-b border-zinc-800 pb-2"
              >
                <span>{card.cardName}</span>
                <span className="app-muted text-sm">
                  {card.appearances} appearances
                </span>
              </div>
            ))}
            {!cardStats.commanders.length ? (
              <p className="app-muted text-sm">
                Commander statistics appear after deck submissions.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="app-panel p-5">
        <h2 className="text-2xl font-semibold">Game history</h2>
        <div className="mt-4 space-y-4">
          {league.games.map((game) => (
            <article
              key={game.id}
              className="rounded border border-zinc-800 p-4"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">
                  {game.round.name} game · {dateLabel(game.playedAt)}
                </h3>
                {game.notes ? (
                  <p className="app-muted text-sm">{game.notes}</p>
                ) : null}
              </div>
              <ol className="mt-3 grid gap-2 md:grid-cols-2">
                {[...game.participants]
                  .sort(
                    (a, b) =>
                      (a.finishPosition || 99) - (b.finishPosition || 99),
                  )
                  .map((participant) => (
                    <li
                      key={participant.id}
                      className="rounded bg-zinc-950/50 p-3"
                    >
                      <div className="flex justify-between gap-2">
                        <span>
                          <strong>
                            {participant.finishPosition
                              ? `#${participant.finishPosition} `
                              : ""}
                            {participant.member.user.displayName}
                          </strong>
                          <span className="app-muted">
                            {" "}
                            · {participant.result.toLowerCase()}
                          </span>
                        </span>
                        <span className="font-semibold">
                          {participant.pointsAwarded} pts
                        </span>
                      </div>
                      <p className="app-muted mt-1 text-sm">
                        Frozen deck:{" "}
                        {participant.deckSubmission?.deckName || "None"} ·{" "}
                        {participant.deckSubmission?.cards.reduce(
                          (sum, card) => sum + card.quantity,
                          0,
                        ) || 0}{" "}
                        cards
                      </p>
                    </li>
                  ))}
              </ol>
            </article>
          ))}
          {!league.games.length ? (
            <p className="app-muted text-sm">No games have been recorded.</p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="app-panel p-5">
          <h2 className="text-2xl font-semibold">League players</h2>
          <ul className="mt-3 space-y-2">
            {league.members.map((member) => (
              <li
                key={member.id}
                className="flex justify-between border-b border-zinc-800 pb-2"
              >
                <span>{member.user.displayName}</span>
                <span className="app-muted text-sm">
                  {member.role.toLowerCase()} · {member.decks.length} league
                  decks
                </span>
              </li>
            ))}
          </ul>
          {isAdmin && availableUsers.length ? (
            <form action={addLeagueMember} className="mt-4 flex gap-2">
              <input type="hidden" name="leagueId" value={league.id} />
              <select
                name="userId"
                required
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              >
                <option value="">Add archive user</option>
                {availableUsers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </select>
              <button className="rounded border border-cyan-700 px-3 py-2">
                Add
              </button>
            </form>
          ) : null}
        </div>
        <div className="app-panel p-5">
          <h2 className="text-2xl font-semibold">League inventory locations</h2>
          <p className="app-muted text-sm">
            Only explicitly linked public locations are part of this league.
          </p>
          <ul className="mt-3 space-y-2">
            {league.locations.map((entry) => {
              const owner =
                entry.location.ownerPlayer.users[0]?.displayName ||
                entry.location.ownerPlayer.displayName;
              const quantity = entry.location.inventoryItems.reduce(
                (sum, item) => sum + item.quantity,
                0,
              );
              return (
                <li
                  key={entry.locationId}
                  className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2"
                >
                  <span>
                    {owner} · {entry.location.name}
                    <span className="app-muted text-sm">
                      {" "}
                      · {quantity} cards
                    </span>
                  </span>
                  {isAdmin ? (
                    <form action={removeLeagueLocation}>
                      <input type="hidden" name="leagueId" value={league.id} />
                      <input
                        type="hidden"
                        name="locationId"
                        value={entry.locationId}
                      />
                      <button className="text-sm text-red-300">Remove</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
            {!league.locations.length ? (
              <li className="app-muted text-sm">
                No public inventory locations are linked.
              </li>
            ) : null}
          </ul>
          {isAdmin && availableLocations.length ? (
            <form action={addLeagueLocation} className="mt-4 flex gap-2">
              <input type="hidden" name="leagueId" value={league.id} />
              <select
                name="locationId"
                required
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              >
                <option value="">Add public member location</option>
                {availableLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.ownerName} · {location.name}
                  </option>
                ))}
              </select>
              <button className="rounded border border-cyan-700 px-3 py-2">
                Add
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
