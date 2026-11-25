"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function BulkCleanupSettings({ enabled: initialEnabled, maxCopies: initialMax, includeDecks: initialDecks, revision: initialRevision }: {
  enabled: boolean; maxCopies: number; includeDecks: boolean; revision: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled), [maxCopies, setMax] = useState(initialMax),
    [includeDecks, setDecks] = useState(initialDecks), [revision, setRevision] = useState(initialRevision),
    [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const router = useRouter();
  return <section className="app-panel space-y-3 p-4" id="bulk-cleanup" aria-labelledby="bulk-cleanup-title">
    <h2 id="bulk-cleanup-title" className="font-semibold">Personal bulk cleanup</h2>
    <p className="text-sm text-[var(--app-muted)]">Find extra copies in Card Hunt and see which confirmed scans to pull before adding them to inventory. Each printing, finish and language has its own limit.</p>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/bulk-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SETTINGS", enabled, maxCopies, includeDecks, revision }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        setRevision(result.revision); setMessage("Bulk cleanup settings saved."); router.refresh();
      } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved."); }
      finally { setBusy(false); }
    }}>
      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />Enable bulk cleanup for my collection</label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">Maximum copies per printing<input className="app-input w-24 rounded border bg-transparent p-2" type="number" min={0} max={1000000} required disabled={busy || !enabled} value={maxCopies} onChange={event => setMax(Number(event.target.value))} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeDecks} disabled={busy || !enabled} onChange={event => setDecks(event.target.checked)} />Count copies in decks toward the maximum</label>
      </div>
      <p className="text-sm text-[var(--app-muted)]">Deck cards, reserved copies and League cards stay protected. Nothing is removed or ignored automatically.</p>
      <button className="app-button rounded border px-3 py-2" disabled={busy}>{busy ? "Saving…" : "Save bulk cleanup settings"}</button>
      <p role="status" className="text-sm">{message}</p>
    </form>
  </section>;
}
