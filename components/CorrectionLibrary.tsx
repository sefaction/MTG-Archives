"use client";
import { useEffect, useState } from "react";
import { filterPanelClass as panel, filterButtonClass as button, filterSelectClass as select } from "./filterStyles";
import { CorrectionReviewHistory } from "./CorrectionReviewHistory";
import type { getCorrectionLibrary } from "@/lib/acquisition-correction-access";
type Library = Awaited<ReturnType<typeof getCorrectionLibrary>>;
type Example = Library["examples"][number];
function title(example: Example) {
  const label = example.label as { printing?: { name?: string; setCode?: string; collectorNumber?: string } } | null;
  return label?.printing?.name ? `${label.printing.name} · ${label.printing.setCode ?? ""} ${label.printing.collectorNumber ?? ""}` : "No current label";
}
function CorrectionOriginal({ owner, exampleId }: { owner: string; exampleId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  return <div className="mt-3">
    {state === "loading" && <p role="status">Loading preserved original…</p>}
    {state === "error" && <div role="alert" className={panel}>
      The preserved original could not be read. Retry or ask an administrator to check the copy.
      <button className={button + " ml-2"} onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>Retry original</button>
    </div>}
    <img key={attempt} src={`/api/acquisition/corrections/${exampleId}?owner=${encodeURIComponent(owner)}&attempt=${attempt}`}
      alt="Preserved original correction photo" className="max-w-full max-h-[32rem] object-contain"
      hidden={state === "error"} onLoad={() => setState("loaded")} onError={() => setState("error")} />
  </div>;
}
export function CorrectionLibrary({ owners, initialOwner }: { owners: { id: string; name: string }[]; initialOwner: string }) {
  const [owner, setOwner] = useState(initialOwner), [cursor, setCursor] = useState<string>(), [history, setHistory] = useState<(string | undefined)[]>([]);
  const [data, setData] = useState<Library>(), [error, setError] = useState(""), [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0), [remove, setRemove] = useState<string>(), [original, setOriginal] = useState<string>(),
    [reviewHistory, setReviewHistory] = useState<string>();
  useEffect(() => {
    if (!owner) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) { setData(undefined); setError(""); setRemove(undefined); setOriginal(undefined); setReviewHistory(undefined); }
    });
    const query = new URLSearchParams({ owner, ...(cursor ? { cursor } : {}) });
    fetch(`/api/acquisition/corrections?${query}`, { cache: "no-store" }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Correction photos could not load");
      if (active) setData(value);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [owner, cursor, reload]);
  async function change(example: Example, action: "WITHDRAW_LABEL" | "REMOVE") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/acquisition/corrections/${example.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, action }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "The example could not be updated");
      setRemove(undefined); setReload(n => n + 1);
    } catch (error: any) { setError(error.message); } finally { setBusy(false); }
  }
  const usage = data?.usage;
  return <div className="space-y-4 min-w-0">
    {owners.length > 1 && <label className="block">Owner <select disabled={busy} className={select + " ml-2"} value={owner} onChange={event => { setOwner(event.target.value); setCursor(undefined); setHistory([]); }}>
      {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
    {error && <div role="alert" className={panel}>{error}<button className={button + " ml-2"} onClick={() => setReload(n => n + 1)}>Retry</button></div>}
    {!owner ? <p>No collection owner is available for this account.</p> : !data && !error ? <p role="status">Loading correction photos…</p> : null}
    {usage && <div className={panel}>
      <p>{((Number(usage.preservedBytes) + Number(usage.reservedBytes) + Number(usage.evidenceBytes)) / 1e9).toFixed(2)} GB used or reserved of {(Number(usage.limitBytes) / 1e9).toFixed(0)} GB. GB uses 1,000,000,000 bytes.</p>
      <p className="text-sm">{usage.pendingCount} pending originals · {(Number(usage.pendingBytes) / 1e6).toFixed(1)} MB waiting. {usage.selectedControls} of {usage.sampleCap} normal-scan controls selected for the initial cohort.</p>
      {usage.warnings.length > 0 && <p role="status">{usage.warnings.some(w => w.code === "WAITING_FOR_SPACE") ? "The library allowance is full. Pending originals remain protected; remove examples or ask an administrator to increase the allowance." : "Some originals could not be copied. Their source photos remain protected for retry."}</p>}
    </div>}
    {data?.examples.length === 0 && <p>No correction photos have been collected.</p>}
    <div className="space-y-3">{data?.examples.map(example => <article key={example.id} className={panel}>
      <h2 className="font-semibold break-words">{title(example)}</h2>
      <p className="text-sm">{new Date(example.createdAt).toLocaleString()} · {example.normalControl ? "Random normal-scan control" : "Correction example"} · {example.labelState === "WITHDRAWN" ? "Label withdrawn" : "Label unverified"}</p>
      <p className="text-sm">{example.blob.state === "PRESERVED" ? "Original preserved" : "Original waiting to be preserved"} · {(example.blob.bytes / 1e6).toFixed(2)} MB</p>
      <div className="flex flex-wrap gap-2 mt-2">
        {example.blob.state === "PRESERVED" && <button className={button} onClick={() => setOriginal(original === example.id ? undefined : example.id)}>{original === example.id ? "Hide original" : "View original"}</button>}
        {example.labelState !== "WITHDRAWN" && <button disabled={busy} className={button} onClick={() => void change(example, "WITHDRAW_LABEL")}>Withdraw label</button>}
        <button disabled={busy} className={button} onClick={() => setRemove(example.id)}>Remove example</button>
        <button disabled={busy} className={button} aria-expanded={reviewHistory === example.id} aria-controls={`correction-history-${example.id}`}
          onClick={() => setReviewHistory(reviewHistory === example.id ? undefined : example.id)}>{reviewHistory === example.id ? "Hide review history" : "View review history"}</button>
      </div>
      {original === example.id && <CorrectionOriginal key={`${owner}:${example.id}`} owner={owner} exampleId={example.id} />}
      {reviewHistory === example.id && <CorrectionReviewHistory key={`${owner}:${example.id}`} owner={owner} exampleId={example.id} />}
      {remove === example.id && <div className="mt-3 border rounded p-3 space-y-2">
        <p>Remove this example, its label and saved recognition evidence?</p>
        <p className="text-sm">{example.blob._count.examples > 1 ? "Its original is shared with another of your examples, so the original will stay preserved." : `${(example.blob.bytes / 1e6).toFixed(2)} MB of original bytes will be released when cleanup finishes.`} Your scan batch and Inventory stay as they are. Existing backups can retain removed bytes until the configured backup retention expires.</p>
        <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => void change(example, "REMOVE")}>Confirm removal</button><button disabled={busy} className={button} onClick={() => setRemove(undefined)}>Keep example</button></div>
      </div>}
    </article>)}</div>
    {data && <div className="flex gap-2"><button className={button} disabled={busy || history.length === 0} onClick={() => { setCursor(history.at(-1)); setHistory(h => h.slice(0,-1)); }}>Previous</button>
      <button className={button} disabled={busy || !data.nextCursor} onClick={() => { setHistory(h => [...h, cursor]); setCursor(data.nextCursor ?? undefined); }}>Next</button></div>}
  </div>;
}
