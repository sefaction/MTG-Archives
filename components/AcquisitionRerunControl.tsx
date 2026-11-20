"use client";
import { useEffect, useRef, useState } from "react";
import type { AcquisitionRerunScope, AcquisitionRerunStatus } from "@/lib/acquisition-rerun";
import { filterButtonClass as button, filterPanelClass as panel } from "./filterStyles";

export function AcquisitionRerunControl({scope}: {scope: AcquisitionRerunScope}) {
  const [record, setRecord] = useState<AcquisitionRerunStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const requestKey = useRef<string | null>(null);
  const endpoint = `/api/acquisition/rerun?scope=${scope}`;
  const active = record?.status === "QUEUED" || record?.status === "RUNNING";
  useEffect(() => {
    let cancelled = false;
    async function read() {
      try {
        const response = await fetch(endpoint, {cache: "no-store"});
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setRecord(data);
      } catch { /* A later poll recovers without discarding a frozen POST. */ }
    }
    void read();
    const timer = setInterval(() => void read(), 4000);
    return () => {cancelled = true; clearInterval(timer);};
  }, [endpoint]);
  async function submit() {
    if (busy) return;
    requestKey.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/acquisition/rerun", {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({scope, requestKey: requestKey.current})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not queue recognition. Retry this request.");
      setRecord(data); setConfirming(false); requestKey.current = null; setRetry(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Connection interrupted. Retry this request.");
      setRetry(true);
    } finally {setBusy(false);}
  }
  return <section aria-label={scope === "ALL" ? "Recognition for all users" : "Recognition for my batches"}
    className={`${panel} p-3 space-y-2 text-sm`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Re-run recognition</h2>
        <p>{scope === "ALL" ? "Unconfirmed cards in pending batches for every user." : "Unconfirmed cards across all your pending batches, regardless of the list filter."}</p></div>
      {!confirming && <button type="button" className={button} disabled={busy || Boolean(active)}
        onClick={() => setConfirming(true)}>{active ? "Queueing rerun…" : scope === "ALL" ? "Re-run all users’ pending batches" : "Re-run my pending batches"}</button>}
    </div>
    {confirming && <div className="space-y-2 rounded border border-[var(--app-border)] p-3">
      <p>{scope === "ALL" ? "Recheck every user’s eligible unconfirmed scans?" : "Recheck all your eligible unconfirmed scans?"}
        {" "}Saved confirmations, Inventory and manual card boundaries are kept. Cancelled, trashed, excluded and unavailable scans are skipped.</p>
      <p>Recognition runs in the background. You can leave this page after submitting.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void submit()}>
        {busy ? "Submitting…" : retry ? "Retry same request" : "Confirm rerun"}</button>
        <button type="button" className={button} disabled={busy} onClick={() => {setConfirming(false); setError("");}}>Close</button></div>
    </div>}
    {error && <p role="alert">{error}</p>}
    {record && <p role="status" aria-live="polite">
      {active ? `Preparing rerun: ${record.queued.toLocaleString()} cards queued so far.` :
        record.status === "CANCELLED" ? `Rerun stopped because account access changed. ${record.queued.toLocaleString()} cards were queued.` :
        record.queued ? `${record.queued.toLocaleString()} cards queued for recognition. Results will update in their batches as workers finish.` :
        "No eligible unconfirmed scans were found. Confirmed cards were kept."}
    </p>}
  </section>;
}
