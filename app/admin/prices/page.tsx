export const dynamic = "force-dynamic";

import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { PriceImportJobsPanel } from "@/components/PriceImportJobsPanel";
import {
  backfillMtgjsonHistoryAction,
  importMtgjsonTodayAction,
  mapMtgjsonCardsAction,
} from "./actions";
import { mtgjsonPriceFileUrl } from "@/lib/mtgjson-prices";
import { providerLabel } from "@/lib/price-history";
import {
  isPriceWorkerHeartbeatFresh,
  listPriceWorkerHeartbeats,
} from "@/lib/price-import-jobs";

export default async function AdminPricesPage() {
  await requireAdminMode();
  const adminStatsEnabled = process.env.ENABLE_ADMIN_PRICE_STATS !== "false";
  const adminStatsStartedAt = process.hrtime.bigint();
  const [
    snapshotCount,
    matchedCards,
    providerRows,
    lastSnapshot,
    recentJobs,
    workerHeartbeats,
  ] = await Promise.all([
    adminStatsEnabled ? prisma.cardPriceSnapshot.count() : Promise.resolve(null),
    adminStatsEnabled
      ? prisma.card.count({ where: { mtgjsonUuid: { not: null } } })
      : Promise.resolve(null),
    adminStatsEnabled
      ? prisma.cardPriceSnapshot.findMany({
          distinct: ["provider"],
          select: { provider: true },
          orderBy: { provider: "asc" },
        })
      : Promise.resolve([]),
    adminStatsEnabled
      ? prisma.cardPriceSnapshot.findFirst({
          orderBy: { importedAt: "desc" },
          select: { importedAt: true, observedDate: true },
        })
      : Promise.resolve(null),
    prisma.priceImportJob.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { requestedBy: { select: { displayName: true, username: true } } },
    }),
    listPriceWorkerHeartbeats(undefined, 5),
  ]);
  const adminStatsMs = Number(process.hrtime.bigint() - adminStatsStartedAt) / 1_000_000;
  if (adminStatsMs > 500) {
    console.warn("[admin-prices] pricing stats diagnostics", {
      elapsedMs: adminStatsMs,
      adminStatsEnabled,
      providerRows: providerRows.length,
      fullHistoryQueried: false,
    });
  }
  const unmatchedCards = adminStatsEnabled
    ? await prisma.card.count({ where: { mtgjsonUuid: null } })
    : null;
  const providers = providerRows.map((row) => row.provider).sort();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <div>
        <h1 className="text-3xl font-bold">Price imports</h1>
          <a className="text-sm text-sky-300 underline" href="/pricing">Open pricing analytics</a>
        <p className="text-zinc-400">
          MTGJSON prices are imported on demand and stored as local
          provider-specific snapshots.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Snapshots stored</p>
          <p className="text-2xl font-bold">{snapshotCount ?? "Disabled"}</p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Cards mapped to MTGJSON</p>
          <p className="text-2xl font-bold">{matchedCards ?? "Disabled"}</p>
          <p className="text-xs text-zinc-500">
            Unmapped local cards: {unmatchedCards ?? "Disabled"}
          </p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Last successful import</p>
          <p className="text-lg font-semibold">
            {lastSnapshot?.importedAt.toISOString() ?? "Never"}
          </p>
          <p className="text-xs text-zinc-500">
            Latest observed date:{" "}
            {lastSnapshot?.observedDate.toISOString().slice(0, 10) ?? "—"}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">MTGJSON import controls</h2>
        <p className="text-sm text-zinc-400">
          Current snapshots download {mtgjsonPriceFileUrl("today")}. Historical
          backfill downloads {mtgjsonPriceFileUrl("history")} and can be large,
          so run it intentionally.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={mapMtgjsonCardsAction}>
            <SubmitButton
              pendingLabel="Mapping…"
              className="rounded border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-950/40"
            >
              Map MTGJSON card UUIDs
            </SubmitButton>
          </form>
          <form action={importMtgjsonTodayAction}>
            <SubmitButton
              pendingLabel="Queueing…"
              className="rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              Import today&apos;s prices
            </SubmitButton>
          </form>
          <form action={backfillMtgjsonHistoryAction}>
            <SubmitButton
              pendingLabel="Queueing…"
              className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Backfill price history
            </SubmitButton>
          </form>
        </div>
        <div
          className={`rounded border p-3 text-sm ${
            isPriceWorkerHeartbeatFresh(workerHeartbeats[0])
              ? "border-emerald-800 bg-emerald-950/20 text-emerald-100"
              : "border-amber-800 bg-amber-950/20 text-amber-100"
          }`}
        >
          Price worker:{" "}
          {isPriceWorkerHeartbeatFresh(workerHeartbeats[0])
            ? "Online"
            : "Not detected"}
          {workerHeartbeats[0]?.lastSeenAt ? (
            <span className="text-zinc-300">
              {" "}
              · Last heartbeat {workerHeartbeats[0].lastSeenAt.toISOString()}
            </span>
          ) : null}
          {!isPriceWorkerHeartbeatFresh(workerHeartbeats[0]) ? (
            <p className="mt-1 text-xs">
              No price worker is online. Jobs will remain queued until the
              price-worker service starts.
            </p>
          ) : null}
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-300">
          Buttons queue database-backed background jobs processed by the price
          worker, so browser tabs and request timeouts do not control the
          import. Advanced fallback from the app container:
          <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-xs text-amber-50">
            npm run prices:import:today{"\n"}npm run prices:import:history
          </pre>
        </div>
      </section>

      <PriceImportJobsPanel
        initialJobs={JSON.parse(JSON.stringify(recentJobs))}
        initialWorker={JSON.parse(
          JSON.stringify({
            online: isPriceWorkerHeartbeatFresh(workerHeartbeats[0]),
            heartbeats: workerHeartbeats,
          }),
        )}
      />

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Providers available</h2>
        <p className="text-sm text-zinc-400">
          {providers.length
            ? providers.map(providerLabel).join(", ")
            : "No MTGJSON providers imported yet."}
        </p>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Pricing analytics</h2>
        <p className="sr-only">Collection value history moved to dedicated analytics.</p>
        <p className="text-sm text-zinc-400">Heavy collection value and trend calculations are available on the dedicated pricing page.</p>
        <a className="text-sm text-sky-300 underline" href="/pricing">Open pricing analytics</a>
      </section>
    </main>
  );
}
