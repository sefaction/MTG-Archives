"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { filterButtonClass as button, filterDangerButtonClass as danger } from "./filterStyles";

export function AcquisitionBatchActions({id, batchNumber, cancelled = false, trashed = false, onChanged}: {
  id: string; batchNumber: number; cancelled?: boolean; trashed?: boolean; onChanged?: () => void;
}) {
  const router = useRouter(), [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<"cancel" | "trash" | null>(null), [error, setError] = useState("");
  const run = (action: string) => start(async () => {
    setError("");
    try {
      const response = await fetch(`/api/acquisition/${encodeURIComponent(id)}/lifecycle`, {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({action})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Batch action failed. Try again.");
      setConfirm(null); router.refresh(); onChanged?.();
    } catch (error) {setError(error instanceof Error ? error.message : "Batch action failed. Try again.");}
  });
  return <div className="space-y-2" aria-label={`Manage batch ${batchNumber}`}>
    <div className="flex flex-wrap gap-2">
      {trashed ? <button className={button} disabled={busy} onClick={() => run("restore")}>Restore batch</button> : <>
        {cancelled ? <button className={button} disabled={busy} onClick={() => run("resume-processing")}>Resume processing</button> :
          <button className={button} disabled={busy} onClick={() => setConfirm("cancel")}>Cancel batch</button>}
        <button className={button} disabled={busy} onClick={() => setConfirm("trash")}>Move to Trash</button>
      </>}
    </div>
    {confirm && <div data-batch-action-confirm className="rounded border border-[var(--app-border)] p-3 space-y-2" role="group" aria-label={`Confirm ${confirm} batch ${batchNumber}`}>
      <p className="text-sm">{confirm === "trash" ? "Hide this batch and stop processing? You can restore it for seven days. After that its saved scans will be deleted. Cards already added to Inventory will stay there." :
        "Stop processing this batch? Saved scans and reviews will stay available. An accepted scanner load will finish saving before it stops; no new load will start."}</p>
      <div className="flex flex-wrap gap-2">
        <button className={danger} disabled={busy} onClick={() => run(confirm)}>{busy ? "Saving…" : confirm === "trash" ? "Confirm move to Trash" : "Confirm cancel batch"}</button>
        <button className={button} disabled={busy} onClick={() => setConfirm(null)}>Keep batch</button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
  </div>;
}
