export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { LeagueNav } from "@/components/league/LeagueNav";
import { ColorIdentitySymbols } from "@/components/mtg/ColorIdentitySymbols";
import { requireLogin } from "@/lib/auth";
import {
  buildLeagueDeckAnalytics,
  type LeagueAnalyticsSubmissionInput,
} from "@/lib/commander-league-analytics";
import { prisma } from "@/lib/prisma";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function decimal(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

function Meter({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
      <div
        className="h-full rounded-full bg-cyan-500"
        style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%` }}
      />
    </div>
  );
}

function UsageList({
  rows,
  empty,
}: {
  rows: Array<{
    key: string;
    name: string;
    appearances: number;
    copies: number;
  }>;
  empty: string;
}) {
  const max = Math.max(0, ...rows.map((row) => row.appearances));
  return (
    <div className="mt-4 space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="mb-1 flex items-end justify-between gap-3 text-sm">
            <span className="font-medium">{row.name}</span>
            <span className="app-muted whitespace-nowrap">
              {row.appearances} {row.appearances === 1 ? "deck" : "decks"} ·{" "}
              {row.copies} {row.copies === 1 ? "copy" : "copies"}
            </span>
          </div>
          <Meter value={row.appearances} max={max} />
        </div>
      ))}
      {!rows.length ? <p className="app-muted text-sm">{empty}</p> : null}
    </div>
  );
}

function WinRateTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{
    key?: string;
    name: string;
    appearances: number;
    wins: number;
    winRate: number;
  }>;
}) {
  return (
    <section className="app-panel overflow-hidden">
      <div className="border-b border-zinc-800 p-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="app-muted text-sm">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-right">Used</th>
              <th className="p-3 text-right">Wins</th>
              <th className="p-3 text-right">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key ?? row.name}
                className="border-t border-zinc-800"
              >
                <td className="p-3 font-medium">{row.name}</td>
                <td className="p-3 text-right">{row.appearances}</td>
                <td className="p-3 text-right">{row.wins}</td>
                <td className="p-3 text-right font-semibold">
                  {percent(row.winRate)}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="app-muted p-5 text-center">
                  No match deck data is available yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function CommanderLeagueStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ player?: string }>;
}) {
  const user = await requireLogin();
  const { leagueId } = await params;
  const query = await searchParams;
  const league = await prisma.commanderLeague.findFirst({
    where: {
      id: leagueId,
      members: { some: { userId: user.id, active: true } },
    },
    select: {
      id: true,
      name: true,
      year: true,
      members: {
        where: { active: true },
        orderBy: { user: { displayName: "asc" } },
        select: { id: true, user: { select: { displayName: true } } },
      },
      games: {
        orderBy: { playedAt: "asc" },
        select: {
          round: { select: { monthNumber: true, name: true } },
          participants: {
            select: {
              result: true,
              member: {
                select: { id: true, user: { select: { displayName: true } } },
              },
              deckSubmission: {
                select: {
                  id: true,
                  cards: {
                    select: {
                      cardName: true,
                      oracleId: true,
                      quantity: true,
                      isCommander: true,
                      section: true,
                      card: {
                        select: {
                          manaValue: true,
                          colorIdentity: true,
                          typeLine: true,
                          setCode: true,
                          setName: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!league) notFound();

  const selectedMember = league.members.find(
    (member) => member.id === query.player,
  );
  const submissions: LeagueAnalyticsSubmissionInput[] = league.games.flatMap(
    (game) =>
      game.participants.flatMap((participant) => {
        const submission = participant.deckSubmission;
        if (!submission) return [];
        return [
          {
            id: submission.id,
            memberId: participant.member.id,
            displayName: participant.member.user.displayName,
            monthNumber: game.round.monthNumber,
            monthName: game.round.name,
            result: participant.result,
            cards: submission.cards.map((card) => ({
              cardName: card.cardName,
              oracleId: card.oracleId,
              quantity: card.quantity,
              isCommander: card.isCommander,
              section: card.section,
              manaValue: card.card?.manaValue ?? null,
              colorIdentity: card.card?.colorIdentity ?? null,
              typeLine: card.card?.typeLine ?? null,
              setCode: card.card?.setCode ?? null,
              setName: card.card?.setName ?? null,
            })),
          },
        ];
      }),
  );
  const stats = buildLeagueDeckAnalytics(submissions, selectedMember?.id);
  const maxCurve = Math.max(
    0,
    ...stats.manaCurve.map((bucket) => bucket.cards),
  );
  const compositionRows = [
    ["Creatures", stats.composition.creatures],
    ["Instants & sorceries", stats.composition.spells],
    ["Other permanents", stats.composition.otherPermanents],
    ["Lands", stats.composition.lands],
  ] as const;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <LeagueNav leagueId={league.id} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
            {league.name} · {league.year}
          </p>
          <h1 className="text-4xl font-bold">League statistics</h1>
          <p className="app-muted mt-2 max-w-3xl">
            Analytics use immutable deck snapshots from completed matches.
            Sideboards and maybeboards are excluded. Basic lands count toward
            deck structure, but not card rankings or set usage.
          </p>
        </div>
        <form className="app-card flex items-end gap-2 p-3">
          <label className="text-sm">
            <span className="app-muted mb-1 block">Breakdown</span>
            <select
              name="player"
              defaultValue={selectedMember?.id ?? ""}
              className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
            >
              <option value="">Overall league</option>
              {league.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user.displayName}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded border border-cyan-700 px-3 py-2 text-sm">
            View
          </button>
        </form>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Scope", selectedMember?.user.displayName ?? "Overall"],
          ["Match decks", stats.submissionCount],
          ["Average mana value", decimal(stats.averageManaValue)],
          ["Average land count", decimal(stats.averageLandCount)],
        ].map(([label, value]) => (
          <div key={String(label)} className="app-card p-4">
            <p className="app-muted text-sm">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Most-played cards</h2>
          <p className="app-muted text-sm">
            Nonbasic, noncommander cards ranked by match deck appearances.
          </p>
          <UsageList
            rows={stats.topCards}
            empty="Cards appear after the first recorded match."
          />
        </div>
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Most-played commanders</h2>
          <p className="app-muted text-sm">
            Partners count as individual commanders.
          </p>
          <UsageList
            rows={stats.commanders}
            empty="Commanders appear after the first recorded match."
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="app-panel overflow-hidden">
          <div className="border-b border-zinc-800 p-5">
            <h2 className="text-xl font-semibold">Monthly deck trends</h2>
            <p className="app-muted text-sm">
              Average mana value and land count per match deck each month.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-3 text-left">Month</th>
                  <th className="p-3 text-right">Decks</th>
                  <th className="p-3 text-right">Avg. mana</th>
                  <th className="p-3 text-right">Avg. lands</th>
                  <th className="p-3 text-left">Top colors</th>
                </tr>
              </thead>
              <tbody>
                {stats.months.map((month) => (
                  <tr
                    key={month.monthNumber}
                    className="border-t border-zinc-800"
                  >
                    <td className="p-3 font-medium">{month.monthName}</td>
                    <td className="p-3 text-right">{month.decks}</td>
                    <td className="p-3 text-right">
                      {decimal(month.averageManaValue)}
                    </td>
                    <td className="p-3 text-right">
                      {decimal(month.averageLandCount)}
                    </td>
                    <td className="p-3">
                      {month.topColorIdentity === "Colorless" ||
                      month.topColorIdentity === "Unknown" ? (
                        month.topColorIdentity
                      ) : (
                        <ColorIdentitySymbols value={month.topColorIdentity} />
                      )}
                    </td>
                  </tr>
                ))}
                {!stats.months.length ? (
                  <tr>
                    <td colSpan={5} className="app-muted p-5 text-center">
                      No monthly snapshots yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Color identity</h2>
          <p className="app-muted text-sm">
            Usage and match win rate by commander identity.
          </p>
          <div className="mt-4 space-y-3">
            {stats.colorIdentities.map((color) => (
              <div
                key={color.name}
                className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-2"
              >
                <span className="font-medium">
                  {color.name === "Colorless" || color.name === "Unknown" ? (
                    color.name
                  ) : (
                    <ColorIdentitySymbols value={color.name} />
                  )}
                </span>
                <span className="app-muted text-sm">
                  {color.appearances} decks · {percent(color.winRate)} wins
                </span>
              </div>
            ))}
            {!stats.colorIdentities.length ? (
              <p className="app-muted text-sm">No color data yet.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Mana curve</h2>
          <p className="app-muted text-sm">
            Average shape across nonland cards in match decks.
          </p>
          <div
            className="mt-5 grid grid-cols-8 items-end gap-2"
            aria-label="Mana curve"
          >
            {stats.manaCurve.map((bucket) => (
              <div key={bucket.label} className="text-center">
                <div className="flex h-36 items-end rounded bg-zinc-950/60 p-1">
                  <div
                    className="w-full rounded-sm bg-cyan-500"
                    style={{
                      height: `${maxCurve ? Math.max(3, (bucket.cards / maxCurve) * 100) : 0}%`,
                    }}
                    title={`${bucket.cards} cards`}
                  />
                </div>
                <p className="mt-1 font-semibold">{bucket.label}</p>
                <p className="app-muted text-xs">{bucket.cards}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Deck composition</h2>
          <p className="app-muted text-sm">
            Quantity-weighted across every match deck.
          </p>
          <div className="mt-5 space-y-4">
            {compositionRows.map(([label, value]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="app-muted">
                    {value} ·{" "}
                    {percent(
                      stats.composition.total
                        ? value / stats.composition.total
                        : 0,
                    )}
                  </span>
                </div>
                <Meter value={value} max={stats.composition.total} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <WinRateTable
          title="Commander win rate"
          description="Every commander appearance; small samples remain visible."
          rows={stats.commanderWinRates}
        />
        <WinRateTable
          title="Color win rate"
          description="Results grouped by the submitted commanders' combined identity."
          rows={stats.colorIdentities}
        />
        <WinRateTable
          title="Card win rate"
          description="Nonbasic cards with at least two match appearances."
          rows={stats.cardWinRates}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="app-panel p-5">
          <h2 className="text-xl font-semibold">Signature cards</h2>
          <p className="app-muted text-sm">
            Cards disproportionately associated with a player, with at least two
            appearances.
          </p>
          <div className="mt-4 space-y-3">
            {stats.signatureCards.map((card) => (
              <div key={card.key} className="border-b border-zinc-800 pb-2">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{card.cardName}</span>
                  <span className="text-sm text-cyan-300">
                    {percent(card.signatureShare)} theirs
                  </span>
                </div>
                <p className="app-muted text-xs">
                  {card.displayName} · {card.appearances} of{" "}
                  {card.leagueAppearances} league appearances
                </p>
              </div>
            ))}
            {!stats.signatureCards.length ? (
              <p className="app-muted text-sm">
                More repeated deck appearances are needed.
              </p>
            ) : null}
          </div>
        </div>
        <div className="app-panel overflow-hidden">
          <div className="border-b border-zinc-800 p-5">
            <h2 className="text-xl font-semibold">Set usage trends</h2>
            <p className="app-muted text-sm">
              Submitted copies and unique cards, plus average copies per match
              deck by month.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-3 text-left">Set</th>
                  <th className="p-3 text-right">Copies</th>
                  <th className="p-3 text-right">Unique</th>
                  <th className="p-3 text-right">Avg/deck</th>
                  <th className="p-3 text-left">Monthly average</th>
                </tr>
              </thead>
              <tbody>
                {stats.setUsage.map((set) => (
                  <tr key={set.setCode} className="border-t border-zinc-800">
                    <td className="p-3">
                      <strong>{set.setCode}</strong>
                      <span className="app-muted ml-2 text-xs">
                        {set.setName}
                      </span>
                    </td>
                    <td className="p-3 text-right">{set.copies}</td>
                    <td className="p-3 text-right">{set.uniqueCards}</td>
                    <td className="p-3 text-right">
                      {set.averageCopiesPerDeck.toFixed(2)}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {set.monthlyAverage.map((month) => (
                          <span
                            key={month.monthNumber}
                            className="rounded bg-zinc-900 px-1.5 py-1 text-xs"
                            title={`${month.monthName}: ${month.average.toFixed(2)} copies per deck`}
                          >
                            {month.monthName.slice(0, 3)}{" "}
                            {month.average.toFixed(1)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!stats.setUsage.length ? (
                  <tr>
                    <td colSpan={5} className="app-muted p-5 text-center">
                      No set data is available yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
