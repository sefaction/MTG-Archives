import { Nav } from "@/components/Nav";
import { ImportTaskNav } from "@/components/ImportTaskNav";
import { AcquisitionBatchActions } from "@/components/AcquisitionBatchActions";
import { AcquisitionBatchRefresh } from "@/components/AcquisitionBatchRefresh";
import { requireLogin, isAdminModeEnabled } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { batchDashboardQuery, getAcquisitionBatchDashboard } from "@/lib/acquisition-batch-dashboard";
import { filterButtonClass as button, filterInputClass as input, filterPanelClass as panel } from "@/components/filterStyles";
export const dynamic = "force-dynamic";
const views = [{id: "pending", label: "Pending"}, {id: "all", label: "All batches"}, {id: "closed", label: "Closed"}, {id: "cancelled", label: "Cancelled"}, {id: "trash", label: "Trash"}];
const format = (count: number) => count.toLocaleString("en-US");

export default async function BatchDashboardPage({searchParams}: {searchParams: Promise<{view?: string; q?: string; page?: string}>}) {
  const user = await requireLogin(), query = batchDashboardQuery.parse(await searchParams);
  const data = await getAcquisitionBatchDashboard(prisma, {userId: user.id, adminMode: await isAdminModeEnabled(user)}, query);
  const href = (view: string, page = 1) => `/imports/batches?${new URLSearchParams({view, q: query.q, page: String(page)})}`;
  return <main className="min-w-0 p-3 sm:p-6 space-y-4">
    <Nav />
    <div className="flex flex-wrap justify-between items-start gap-3"><div><h1 className="text-3xl font-bold">Batch dashboard</h1>
      <p className="text-sm text-[var(--app-muted)]">{format(data.totals.pending)} {data.totals.pending === 1 ? "batch needs" : "batches need"} closing out · {format(data.totals.batches)} saved {data.totals.batches === 1 ? "batch" : "batches"}</p></div>
      <a className={button} href="/imports/scan?input=scanner#new-scan-batch">New scanner batch</a></div>
    <ImportTaskNav selected="batches" />
    <AcquisitionBatchRefresh />
    <section aria-label="Card totals" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {([ ["Saved cards", data.totals.captured], ["Evaluated", data.totals.evaluated], ["Assigned to storage", data.totals.assigned], ["Confirmed matches", data.totals.confirmed], ["Added to Inventory", data.totals.added] ] as const).map(([label, count]) =>
        <div key={label} className={`${panel} p-3`}><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="text-2xl font-semibold tabular-nums">{format(count)}</p></div>)}
    </section>
    <details className="text-sm text-[var(--app-muted)]"><summary className="cursor-pointer">What the totals mean</summary>
      <p className="mt-2">Evaluated cards have a completed printing check or a saved match review. Assigned to storage means a batch destination has been chosen for those cards. Confirmed matches have a complete saved printing review. Added to Inventory counts completed additions. Totals exclude Trash; retries and repeat images do not count as more cards.</p></details>
    <section aria-label="Batch list" className="space-y-3">
      <nav aria-label="Batch status" className="flex flex-wrap gap-2">{views.map(view => <a key={view.id} href={href(view.id)} aria-current={query.view === view.id ? "page" : undefined}
        className={`${button} ${query.view === view.id ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]" : ""}`}>{view.label}</a>)}</nav>
      <form className="flex flex-wrap items-end gap-2"><input type="hidden" name="view" value={query.view} />
        <label className="flex-1 min-w-0 text-sm">Find a batch<input name="q" defaultValue={query.q} maxLength={100} placeholder="Batch number, storage or owner" className={`${input} block w-full mt-1`} /></label>
        <button className={button}>Search</button>{query.q && <a href={href(query.view).replace(/q=[^&]*/, "q=")} className={button}>Clear</a>}
      </form>
      <p className="text-sm text-[var(--app-muted)]">{format(data.total)} {query.view === "trash" ? data.total === 1 ? "batch in Trash" : "batches in Trash" : data.total === 1 ? "matching batch" : "matching batches"}</p>
      {query.view === "trash" && <p className={`${panel} p-3 text-sm`}>Batches stay recoverable for seven days. After expiry, their saved scans are removed. Inventory additions and their receipts are kept. A scanner load already accepted must finish saving before expiry cleanup can run.</p>}
      {!data.rows.length && <p className={`${panel} p-5`}>{query.view === "pending" ? "No batches need closing out." : "No batches found."}</p>}
      {data.rows.map(batch => <article key={batch.id} aria-label={`Batch ${batch.batchNumber}`} className={`${panel} p-3 sm:p-4 space-y-3`}>
        <div className="flex flex-wrap gap-2 items-start justify-between"><div className="min-w-0"><h2 className="font-semibold text-lg">Batch {batch.batchNumber}</h2>
          <p className="text-sm break-words">{batch.location ?? "Storage unavailable"}{batch.section ? ` · ${batch.section}` : ""} · {batch.owner}</p></div>
          <span className="rounded border border-[var(--app-border)] px-2 py-1 text-xs">{batch.trashed ? "In Trash" : batch.cancelled ? batch.draining ? "Cancelled · finishing accepted load" : "Cancelled" : !batch.pending ? "Closed" : batch.phase === "PAUSED" ? "Waiting for refill" : batch.phase === "CAPTURING" ? "Scanning" : batch.phase === "STOPPING" ? "Finishing accepted load" : "Needs review"}</span></div>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">{([ ["Saved", batch.captured], ["Evaluated", batch.evaluated], ["Storage assigned", batch.assigned], ["Confirmed", batch.confirmed], ["In Inventory", batch.added] ] as const).map(([label, count]) =>
          <div key={label}><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd className="font-semibold tabular-nums">{format(count)}</dd></div>)}</dl>
        {!batch.cancelled && !batch.trashed && batch.pending && <p className="text-sm">{format(batch.captured - batch.confirmed)} {batch.captured - batch.confirmed === 1 ? "match needs" : "matches need"} confirmation · {format(batch.confirmed - batch.added)} confirmed {batch.confirmed - batch.added === 1 ? "card awaits" : "cards await"} Inventory addition{batch.failed ? ` · ${format(batch.failed)} ${batch.failed === 1 ? "card needs" : "cards need"} processing attention` : ""}</p>}
        {batch.trashExpiresAt && batch.trashed && <p className="text-sm">Restore before {new Date(batch.trashExpiresAt).toLocaleString("en-US", {timeZone: "America/Chicago"})}.</p>}
        <div className="flex flex-wrap items-start gap-3">{!batch.trashed && <a href={`/imports/scan?batch=${encodeURIComponent(batch.id)}`} className={button}>{batch.cancelled ? "View saved cards" : "Open batch"}</a>}
          <AcquisitionBatchActions id={batch.id} batchNumber={batch.batchNumber} cancelled={batch.cancelled} trashed={batch.trashed} /></div>
      </article>)}
      <nav aria-label="Batch pages" className="flex flex-wrap items-center gap-3">{data.page > 1 && <a className={button} href={href(query.view, data.page - 1)}>Previous</a>}
        <span className="text-sm">Page {data.page} of {data.pages}</span>{data.page < data.pages && <a className={button} href={href(query.view, data.page + 1)}>Next</a>}</nav>
    </section>
  </main>;
}
