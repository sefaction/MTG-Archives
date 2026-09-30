"use client";

import { useState } from "react";
import type { acquisitionProgressDto } from "@/lib/acquisition-api";
import type { AcquisitionCardReview, AcquisitionDefaults } from "@/lib/acquisition-review";
import { finishForPrinting } from "@/lib/acquisition-finish";
import { filterButtonClass as button, filterPrimaryButtonClass as primary, filterPanelClass as panel } from "./filterStyles";

type Slot = ReturnType<typeof acquisitionProgressDto>["slots"][number];
type Proposal = { photoId: string; position: number; record: AcquisitionCardReview; checked: boolean; saved: boolean; error: string };

export function AcquisitionBulkReview({ batchId, slots, defaults, refresh }: {
  batchId: string; slots: Slot[]; defaults: AcquisitionDefaults; refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [saved, setSaved] = useState(0);
  const [target, setTarget] = useState(0);
  const [rows, setRows] = useState<Proposal[]>([]);
  const [error, setError] = useState("");
  const available = slots.flatMap(slot => {
    const photo = slot.photos.find(p => p.ready && !p.purgedAt);
    return photo && !slot.review && !slot.committed ? [{ photoId: photo.id, position: slot.position + 1 }] : [];
  });
  async function preview() {
    setOpen(true); setLoading(true); setError(""); setLoaded(0); setSaved(0); setRows([]);
    const next: Proposal[] = [];
    try {
      // Bounded requests keep large feeder batches from flooding the worker.
      for (let index = 0; index < available.length; index += 4) {
        const group = await Promise.all(available.slice(index, index + 4).map(async item => {
          const response = await fetch(`/api/acquisition/${batchId}/review?photoId=${item.photoId}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Could not load current match proposals. Retry the preview.");
          const record = await response.json() as AcquisitionCardReview;
          return { ...item, record, checked: Boolean(record.suggestions[0]) && !record.review, saved: false, error: "" };
        }));
        next.push(...group); setLoaded(next.length);
      }
      setRows(next);
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setLoading(false); }
  }
  const choice = (row: Proposal) => row.record.suggestions[0]?.printing;
  const eligible = (row: Proposal) => {
    const printing = choice(row);
    return Boolean(printing && !row.record.review && !row.saved && printing.lang && defaults.condition &&
      finishForPrinting(defaults.finish, printing));
  };
  const selected = rows.filter(row => row.checked && eligible(row));
  async function confirm() {
    setSaving(true); setError(""); setSaved(0); setTarget(selected.length);
    let done = 0;
    const next = [...rows];
    for (let index = 0; index < next.length; index++) {
      const row = next[index];
      if (!row.checked || !eligible(row)) continue;
      const printing = choice(row)!;
      const finish = finishForPrinting(defaults.finish, printing);
      if (!finish) continue;
      try {
        const response = await fetch(`/api/acquisition/${batchId}/review`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept", photoId: row.photoId, revision: row.record.revision,
            decision: { cardId: printing.id, language: printing.lang, finish, condition: defaults.condition } }),
        });
        if (!response.ok) throw new Error((await response.json()).error ?? "Review changed; reload this match");
        next[index] = { ...row, checked: false, saved: true, error: "" };
        setSaved(++done);
      } catch (cause) {
        next[index] = { ...row, checked: false, error: (cause as Error).message };
      }
      setRows([...next]);
    }
    await refresh();
    setSaving(false);
  }
  return <section className={panel + " min-w-0 space-y-3"} aria-label="Bulk match review">
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={loading || saving || !available.length} onClick={() => void preview()}>
        Bulk Confirm Match
      </button>
      <span className="text-sm">{available.length} cards awaiting match review</span>
    </div>
    {open && <div className="space-y-3">
      <p className="text-sm">Compare each scan with its proposed printing. Every proposal starts selected; clear any that needs individual correction. This saves reviews only. Inventory is a separate step.</p>
      <p className="text-sm">Batch defaults: {defaults.finish.toLowerCase()} · {defaults.condition ?? "condition unset"}. Change batch defaults or correct a card before confirming if these do not apply.</p>
      {loading && <p role="status">Loading proposals: {loaded} of {available.length}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && rows.length > 0 && <>
        <div className="flex flex-wrap gap-2 items-center">
          <button className={primary} disabled={saving || selected.length === 0} onClick={() => void confirm()}>
            Confirm {selected.length} selected {selected.length === 1 ? "match" : "matches"}
          </button>
          <button className={button} disabled={saving} onClick={() => void preview()}>Reload proposals</button>
          {saving && <span role="status">Saved {saved} of {target} selected reviews…</span>}
          {!saving && saved > 0 && <span role="status">{saved} {saved === 1 ? "review" : "reviews"} saved. Inventory has not changed.</span>}
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          {rows.map((row, index) => {
            const printing = choice(row);
            const canSelect = eligible(row);
            const proposedFinish = printing ? finishForPrinting(defaults.finish, printing) : null;
            return <div key={row.photoId} className="border border-[var(--app-border)] rounded p-3 min-w-0">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <label className="font-medium"><input type="checkbox" checked={row.checked && canSelect} disabled={saving || !canSelect}
                  onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, checked: event.target.checked } : item))} />{" "}
                  Card {row.position}: {printing?.name ?? "No proposal"}</label>
                <a className="underline text-sm" href={`#capture-card-${row.position}`}>Inspect or correct</a>
              </div>
              {printing && <p className="text-sm">{printing.setCode.toUpperCase()} #{printing.collectorNumber} · {printing.lang?.toUpperCase() ?? "language unknown"} · {row.record.recognitionStatus.replaceAll("_", " ").toLowerCase()}</p>}
              {proposedFinish && proposedFinish !== defaults.finish && <p className="text-sm">This printing supports only {proposedFinish.toLowerCase()}; bulk review will use that finish.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-3xl">
                <img loading="lazy" className="w-full max-h-96 object-contain bg-black/10" src={`/api/acquisition/${batchId}/photos/${row.photoId}`} alt={`Scan of card ${row.position}`} />
                {printing?.imageUri ? <img loading="lazy" className="w-full max-h-96 object-contain bg-black/10" src={printing.imageUri} alt={`Proposed ${printing.name}`} /> : <span>No printing image</span>}
              </div>
              {!canSelect && !row.record.review && !row.saved && <p className="text-sm">{printing ? "This printing needs a finish or language correction before confirmation." : "Wait for a proposal or find the printing manually."}</p>}
              {row.error && <p role="alert" className="text-sm">{row.error}</p>}
              {(row.record.review || row.saved) && <p className="text-sm">Review saved</p>}
            </div>;
          })}
        </div>
      </>}
    </div>}
  </section>;
}
