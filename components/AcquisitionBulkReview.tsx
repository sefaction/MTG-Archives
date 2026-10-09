"use client";

import { useEffect, useRef, useState } from "react";
import type { acquisitionProgressDto } from "@/lib/acquisition-api";
import type { AcquisitionCardReview, AcquisitionDefaults } from "@/lib/acquisition-review";
import { finishForPrinting } from "@/lib/acquisition-finish";
import { BulkReviewUncertainError, saveBulkReview } from "./acquisition-bulk-save";
import { filterButtonClass as button, filterPrimaryButtonClass as primary, filterPanelClass as panel } from "./filterStyles";

type Slot = ReturnType<typeof acquisitionProgressDto>["slots"][number];
type Proposal = { photoId: string; position: number; record: AcquisitionCardReview; checked: boolean; saved: boolean; error: string;
  pendingConfirmation?: { body: string; uncertain: boolean; finish: string; condition: string } };

export function AcquisitionBulkReview({ batchId, slots, defaults, refresh, onOpenChange, onInspect, onConfirmed,
  blockedPhotos, draftsReady, canUsePhotos }: {
  batchId: string; slots: Slot[]; defaults: AcquisitionDefaults; refresh: () => Promise<void>;
  blockedPhotos: Set<string>; draftsReady: boolean; canUsePhotos: (ids: string[]) => boolean;
  onOpenChange?: (open: boolean) => void; onInspect?: (position: number) => void; onConfirmed?: (photoIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [saved, setSaved] = useState(0);
  const [target, setTarget] = useState(0);
  const [rows, setRows] = useState<Proposal[]>([]);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(12);
  const more = useRef<HTMLDivElement>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const selections = useRef(new Map<string, { printingId: string; checked: boolean }>());
  const confirming = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; previewRequest.current?.abort(); }; }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(count => Math.min(count + 12, rows.length));
    }, { rootMargin: "300px" });
    if (more.current) observer.observe(more.current);
    return () => observer.disconnect();
  }, [open, visible, rows.length]);
  function close() {
    previewRequest.current?.abort(); previewRequest.current = null;
    setLoading(false); setOpen(false); onOpenChange?.(false);
  }
  const awaiting = slots.flatMap(slot => {
    const photo = slot.photos.find(p => p.ready && !p.purgedAt);
    return photo && !slot.review && !slot.committed ? [{ photoId: photo.id, position: slot.position + 1 }] : [];
  });
  const available = awaiting.filter(item => !blockedPhotos.has(item.photoId));
  const skipped = awaiting.length - available.length;
  async function preview() {
    if (!draftsReady) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    const current = () => previewRequest.current === controller && !controller.signal.aborted;
    setOpen(true); onOpenChange?.(true); setVisible(12); setLoading(true); setError(""); setLoaded(0); setPreviewTotal(available.length); setSaved(0); setRows([]);
    let count = 0;
    try {
      // Bounded requests keep large feeder batches from flooding the worker.
      for (let index = 0; index < available.length; index += 4) {
        const group = await Promise.all(available.slice(index, index + 4).map(async item => {
          const response = await fetch(`/api/acquisition/${batchId}/review?photoId=${item.photoId}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Could not load current match proposals. Retry the preview.");
          const record = await response.json() as AcquisitionCardReview;
          const printingId = record.suggestions[0]?.printing.id;
          const selection = selections.current.get(item.photoId);
          // Never carry explicit approval to a different proposed printing.
          const checked = printingId && !record.review && canUsePhotos([item.photoId]) &&
            (!selection || (selection.checked && selection.printingId === printingId));
          return { ...item, record, checked: Boolean(checked), saved: false, error: "" };
        }));
        if (!current()) return;
        count += group.length; setLoaded(count);
        // Append to current state so subsequent groups keep operator edits.
        setRows(previous => current() ? [...previous, ...group] : previous);
      }
    } catch (cause) {
      if (current()) setError((cause as Error).message);
    } finally { if (current()) setLoading(false); }
  }
  const choice = (row: Proposal) => row.record.suggestions[0]?.printing;
  const eligible = (row: Proposal) => {
    const printing = choice(row);
    return Boolean(draftsReady && !blockedPhotos.has(row.photoId) && printing && !row.record.review && !row.saved && printing.lang && defaults.condition &&
      finishForPrinting(defaults.finish, printing));
  };
  const selected = rows.filter(row => row.checked && eligible(row));
  const pending = rows.filter(row => row.pendingConfirmation);
  async function confirm(resume = false) {
    if (confirming.current) return;
    confirming.current = true;
    const next = rows.map(row => {
      if (resume || !row.checked || !eligible(row)) return { ...row };
      const printing = choice(row)!;
      const finish = finishForPrinting(defaults.finish, printing)!;
      const body = JSON.stringify({ action: "accept", photoId: row.photoId, revision: row.record.revision,
        // Freeze the loaded proposal and defaults before any write. Recovery
        // must not substitute a later preview, revision or batch default.
        ...(row.record.evidenceToken ? { evidenceTokens: {
          current: row.record.evidenceToken, displayed: [row.record.evidenceToken],
        } } : {}),
        decision: { cardId: printing.id, language: printing.lang,
          finish, condition: defaults.condition } });
      return { ...row, error: "", pendingConfirmation: { body, uncertain: false, finish, condition: defaults.condition! } };
    });
    setSaving(true); setError(""); setSaved(0); setTarget(next.filter(row => row.pendingConfirmation).length); setRows(next);
    let done = 0;
    try {
    for (let index = 0; index < next.length; index++) {
      if (!mounted.current) break;
      const row = next[index];
      if (!row.pendingConfirmation) continue;
      if (!canUsePhotos([row.photoId])) {
        next[index] = { ...row, checked: false,
          pendingConfirmation: row.pendingConfirmation.uncertain ? row.pendingConfirmation : undefined,
          error: row.pendingConfirmation.uncertain ? new BulkReviewUncertainError().message : "Unsaved correction: save or cancel it before bulk confirmation." };
        setRows([...next]);
        if (row.pendingConfirmation.uncertain) break;
        continue;
      }
      try {
        await saveBulkReview(`/api/acquisition/${batchId}/review`, row.pendingConfirmation.body, () => mounted.current && canUsePhotos([row.photoId]));
        next[index] = { ...row, pendingConfirmation: undefined, checked: false, saved: true, error: "" };
        setSaved(++done);
      } catch (cause) {
        const uncertain = cause instanceof BulkReviewUncertainError;
        next[index] = { ...row, checked: false, error: (cause as Error).message,
          pendingConfirmation: uncertain ? { ...row.pendingConfirmation, uncertain: true } : undefined };
        if (uncertain) { setRows([...next]); break; }
      }
      setRows([...next]);
    }
      if (!mounted.current) return;
      await refresh();
      if (done > 0 && !next.some(row => row.error || row.pendingConfirmation)) { close(); onConfirmed?.(next.filter(row => row.saved).map(row => row.photoId)); }
    } finally { setSaved(next.filter(row => row.saved).length); confirming.current = false; setSaving(false); }
  }
  return <section className={panel + " min-w-0 space-y-3"} aria-label="Bulk match review">
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={!draftsReady || loading || saving || pending.length > 0 || !available.length} onClick={() => void preview()}>
        Bulk Confirm Match
      </button>
      <span className="text-sm">{available.length} cards awaiting match review</span>
      {!saving && saved > 0 && <span role="status">{saved} {saved === 1 ? "review" : "reviews"} saved. Inventory has not changed.</span>}
    </div>
    {pending.length > 0 && !saving && <div className="space-y-2">
      <p role="status" className="text-sm">A confirmation is uncertain; later confirmations are paused. Continue with the original printing, finish and condition. Inventory has not changed.</p>
      <button className={primary} disabled={!draftsReady || saving} onClick={() => void confirm(true)}>Continue original confirmations</button>
    </div>}
    {!draftsReady && <p role="status" className="text-sm">Bulk review is waiting for browser draft access. Allow browser storage and reload; individual reviews can still be saved.</p>}
    {skipped > 0 && <p role="status" className="text-sm">{skipped} {skipped === 1 ? "card has an unsaved correction" : "cards have unsaved corrections"} and will be skipped. Save or cancel those corrections to include them.</p>}
    {open && <div className="space-y-3">
      <p className="text-sm">Compare each scan with its proposed printing. Every proposal starts selected; clear any that needs individual correction. This saves reviews only. Inventory is a separate step.</p>
      <p className="text-sm">Batch defaults: {defaults.finish.toLowerCase()} · {defaults.condition ?? "condition unset"}. Change batch defaults or correct a card before confirming if these do not apply.</p>
      <button className={button} disabled={saving} onClick={close}>Back to card list</button>
      {loading && <p role="status">Loading proposals: {loaded} of {previewTotal}</p>}
      {error && <p role="alert">{error}</p>}
      {rows.length > 0 && <>
        <div className="flex flex-wrap gap-2 items-center">
          <button className={primary} disabled={loading || saving || pending.length > 0 || selected.length === 0} onClick={() => void confirm()}>
            Confirm {selected.length} selected {selected.length === 1 ? "match" : "matches"}
          </button>
          <button className={button} disabled={saving || pending.length > 0} onClick={() => void preview()}>Reload proposals</button>
          {saving && <span role="status">Saved {saved} of {target} selected reviews…</span>}
        </div>
        <div className="space-y-3">
          {rows.slice(0, visible).map(row => {
            const printing = choice(row);
            const canSelect = eligible(row);
            const proposedFinish = printing ? finishForPrinting(defaults.finish, printing) : null;
            return <div key={row.photoId} className="border border-[var(--app-border)] rounded p-3 min-w-0">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <label className="font-medium"><input type="checkbox" checked={row.checked && canSelect} disabled={saving || pending.length > 0 || !canSelect}
                  onChange={event => {
                    const checked = event.target.checked;
                    selections.current.set(row.photoId, { printingId: printing!.id, checked });
                    setRows(current => current.map(item => item.photoId === row.photoId ? { ...item, checked } : item));
                  }} />{" "}
                  Card {row.position}: {printing?.name ?? "No proposal"}</label>
                <a className="underline text-sm" href={`#capture-card-${row.position}`} onClick={event => {
                  if (onInspect) { event.preventDefault(); close(); onInspect(row.position); }
                }}>Inspect or correct</a>
              </div>
              {printing && <p className="text-sm">{printing.setCode.toUpperCase()} #{printing.collectorNumber} · {printing.lang?.toUpperCase() ?? "language unknown"} · {row.record.recognitionStatus.replaceAll("_", " ").toLowerCase()}</p>}
              {row.pendingConfirmation && <p className="text-sm">Original confirmation: {row.pendingConfirmation.finish.toLowerCase()} · {row.pendingConfirmation.condition}. Later default changes do not alter this confirmation.</p>}
              {proposedFinish && proposedFinish !== defaults.finish && <p className="text-sm">This printing supports only {proposedFinish.toLowerCase()}; bulk review will use that finish.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-3xl">
                <img loading="lazy" className="w-full max-h-96 object-contain bg-black/10" src={`/api/acquisition/${batchId}/photos/${row.photoId}`} alt={`Scan of card ${row.position}`} />
                {printing?.imageUri ? <img loading="lazy" className="w-full max-h-96 object-contain bg-black/10" src={printing.imageUri} alt={`Proposed ${printing.name}`} /> : <span>No printing image</span>}
              </div>
              {!canSelect && !row.record.review && !row.saved && <p className="text-sm">{blockedPhotos.has(row.photoId) ? "Unsaved correction: save or cancel it before bulk confirmation." : printing ? "This printing needs a finish or language correction before confirmation." : "Wait for a proposal or find the printing manually."}</p>}
              {row.error && <p role="alert" className="text-sm">{row.error}</p>}
              {(row.record.review || row.saved) && <p className="text-sm">Review saved</p>}
            </div>;
          })}
          {visible < rows.length && <div ref={more}><button className={button} onClick={() => setVisible(count => count + 12)}>Load more matches</button></div>}
        </div>
      </>}
    </div>}
  </section>;
}
