"use client";
import {useEffect, useState, useTransition} from "react";
import {useRouter} from "next/navigation";
import {filterButtonClass as button} from "./filterStyles";

export function AcquisitionBatchRefresh() {
  const router = useRouter(), [automatic, setAutomatic] = useState(true), [busy, start] = useTransition();
  useEffect(() => {
    if (!automatic) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || document.querySelector("[data-batch-action-confirm]") ||
        document.activeElement?.matches("input,select,textarea")) return;
      start(() => router.refresh());
    }, 20000);
    return () => window.clearInterval(timer);
  }, [automatic, router]);
  return <div className="flex flex-wrap items-center gap-3 text-sm">
    <button className={button} disabled={busy} onClick={() => start(() => router.refresh())}>{busy ? "Updating…" : "Refresh batches"}</button>
    <label className="flex items-center gap-2"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />Update automatically</label>
  </div>;
}
