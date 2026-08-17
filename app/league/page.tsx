export const dynamic = "force-dynamic";

import Link from "next/link";
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
import { LeagueNav } from "@/components/league/LeagueNav";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createCommanderLeague } from "./actions";

export default async function CommanderLeaguesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const [leagues, users] = await Promise.all([
    prisma.commanderLeague.findMany({
      where: { members: { some: { userId: user.id, active: true } } },
      include: {
        _count: { select: { members: true, games: true, locations: true } },
      },
      orderBy: [{ year: "desc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { isActive: true, playerId: { not: null } },
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
      orderBy: { displayName: "asc" },
    }),
  ]);
  const publicLocations = users.flatMap((candidate) =>
    (candidate.player?.inventoryLocations || [])
      .filter(
        (location) =>
          location.visibility === Visibility.PUBLIC ||
          (location.visibility === Visibility.INHERIT &&
            candidate.inventoryDefaultVisibility ===
              DefaultCollectionVisibility.PUBLIC),
      )
      .map((location) => ({
        ...location,
        ownerName: candidate.displayName,
        ownerUserId: candidate.id,
      })),
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <LeagueNav />
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Independent competition workspace
        </p>
        <h1 className="text-4xl font-bold">Commander League</h1>
        <p className="app-muted mt-2 max-w-3xl">
          Run yearly leagues, freeze the decks submitted for each monthly game,
          calculate standings, and measure the cards that shape the field.
        </p>
      </header>
      {params.error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-red-100">
          {params.error}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        {leagues.map((league) => (
          <Link
            key={league.id}
            href={`/league/${league.id}`}
            className="app-card p-5"
          >
            <p className="text-sm text-cyan-300">
              {league.year} · {league.status.toLowerCase()}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{league.name}</h2>
            <p className="app-muted mt-2 text-sm">
              {league._count.members} players · {league._count.games} games ·{" "}
              {league._count.locations} locations
            </p>
          </Link>
        ))}
        {!leagues.length ? (
          <p className="app-muted md:col-span-3">
            You are not in a Commander league yet. Create the first one below.
          </p>
        ) : null}
      </section>

      <section className="app-panel p-5">
        <h2 className="text-2xl font-semibold">Create a yearly league</h2>
        <p className="app-muted mt-1 text-sm">
          Twelve monthly rounds are created automatically. Players must be
          linked archive users; selected locations must already be public.
        </p>
        <form action={createCommanderLeague} className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-5">
            <label className="md:col-span-2">
              <span className="mb-1 block text-sm app-muted">League name</span>
              <input
                name="name"
                required
                maxLength={120}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm app-muted">Year</span>
              <input
                name="year"
                type="number"
                min={2020}
                max={2200}
                defaultValue={new Date().getFullYear()}
                required
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm app-muted">Win points</span>
              <input
                name="winPoints"
                type="number"
                defaultValue={3}
                required
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-sm app-muted">Draw</span>
                <input
                  name="drawPoints"
                  type="number"
                  defaultValue={1}
                  required
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm app-muted">Loss</span>
                <input
                  name="lossPoints"
                  type="number"
                  defaultValue={0}
                  required
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
                />
              </label>
            </div>
          </div>
          <label>
            <span className="mb-1 block text-sm app-muted">Description</span>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
            />
          </label>
          <div className="grid gap-5 lg:grid-cols-2">
            <fieldset className="rounded border border-zinc-800 p-4">
              <legend className="px-2 font-semibold">Archive players</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="memberUserId"
                      value={candidate.id}
                      defaultChecked={candidate.id === user.id}
                      disabled={candidate.id === user.id}
                    />
                    {candidate.displayName}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="rounded border border-zinc-800 p-4">
              <legend className="px-2 font-semibold">
                Public inventory locations
              </legend>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {publicLocations.map((location) => (
                  <label
                    key={location.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="locationId"
                      value={location.id}
                    />
                    {location.ownerName} · {location.name}
                  </label>
                ))}
                {!publicLocations.length ? (
                  <p className="app-muted text-sm">
                    No public normal locations are available.
                  </p>
                ) : null}
              </div>
            </fieldset>
          </div>
          <button className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-600">
            Create Commander league
          </button>
        </form>
      </section>
    </main>
  );
}
