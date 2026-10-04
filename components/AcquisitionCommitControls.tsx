"use client";
import { useRef, useState } from "react";
import { StorageDestinationPicker } from "./StorageDestinationPicker";
import type { StorageLocation } from "@/lib/storage-sections";
import type { acquisitionProgressDto } from "@/lib/acquisition-api";
import type {
  AcquisitionCommitPreview,
  AcquisitionCommitReceipt,
} from "@/lib/acquisition-commit";
import { captureUuid } from "@/lib/acquisition-browser-queue";
import {
  filterButtonClass as button,
  filterPrimaryButtonClass as primary,
  filterInputClass as input,
  filterPanelClass as panel,
} from "./filterStyles";
type Progress = ReturnType<typeof acquisitionProgressDto>;
async function post<T>(id: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/acquisition/${id}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error ?? "The request failed; retry"),
      { status: response.status },
    );
  return result;
}
export function AcquisitionCommitControls({
  progress,
  locations,
  selected,
  onSelect,
  refresh,
  blockedPhotos,
  draftsReady,
  canUsePhotos,
}: {
  progress: Progress;
  locations: StorageLocation[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  refresh: () => Promise<void>;
  blockedPhotos: Set<string>;
  draftsReady: boolean;
  canUsePhotos: (ids: string[]) => boolean;
}) {
  const [locationId, setLocationId] = useState(progress.locationId),
    [section, setSection] = useState(progress.section);
  const [preview, setPreview] = useState<AcquisitionCommitPreview | null>(null);
  const [previewSelection, setPreviewSelection] = useState<string[]>([]);
  const [reason, setReason] = useState(""),
    [confirmOverfill, setConfirmOverfill] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [receipt, setReceipt] = useState<AcquisitionCommitReceipt | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const reviewed = progress.slots.flatMap((s) =>
    !s.committed && s.review && s.photos[0]?.ready ? [s.photos[0].id] : [],
  );
  const eligible = reviewed.filter(id => !blockedPhotos.has(id));
  const skipped = reviewed.length - eligible.length;
  const selectedBlocked = !draftsReady || selected.some(id => blockedPhotos.has(id));
  const stopped = ["STOPPING", "COMPLETE", "CANCELLED"].includes(
    progress.phase,
  );
  const sameSelection =
    JSON.stringify([...selected].sort()) ===
    JSON.stringify([...previewSelection].sort());
  function resetPreview() {
    setPreview(null);
    setReason("");
    setConfirmOverfill(false);
    pending.current = null;
    setRetrying(false);
  }
  async function prepare(photoIds = selected) {
    if (pending.current) return; // An unknown acknowledgement retains its identity.
    if (!canUsePhotos(photoIds)) {
      setError("Save or cancel selected corrections before previewing Inventory."); return;
    }
    setBusy(true);
    setError("");
    setReceipt(null);
    resetPreview();
    try {
      const result = await post<AcquisitionCommitPreview>(progress.id, {
        action: "preview",
        photoIds,
        locationId,
        section,
      });
      if (!canUsePhotos(photoIds)) {
        setError("A selected correction changed during the preview. Save or cancel it, then preview again."); return;
      }
      setPreviewSelection([...photoIds]);
      setPreview(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || (!pending.current && !sameSelection)) return;
    if (!pending.current && !canUsePhotos(previewSelection)) {
      setError("Save or cancel selected corrections, then preview again before adding to Inventory.");
      resetPreview(); return;
    }
    setBusy(true);
    setError("");
    try {
      pending.current ??= {
        action: "commit",
        photoIds: previewSelection,
        locationId,
        section,
        requestKey: captureUuid(),
        previewToken: preview.token,
        overfillReason: preview.overfill ? reason.trim() : null,
      };
      setRetrying(true);
      const result = await post<AcquisitionCommitReceipt>(
        progress.id,
        pending.current,
      );
      setReceipt(result);
      onSelect([]);
      resetPreview();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if ([403, 409].includes((e as { status?: number }).status ?? 0)) {
        resetPreview();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={panel + " space-y-3"}
      aria-label="Add reviewed cards to Inventory"
    >
      <h3 className="font-semibold">Add reviewed cards to Inventory</h3>
      <p className="text-sm">
        Review the destination, then add your confirmed matches. Unselected and
        unfinished cards stay in this batch. Each selected photo adds one copy.
      </p>
      <p role="status">
        {selected.length} selected ·{" "}
        {progress.slots.filter((s) => s.committed).length} already added
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || retrying || !draftsReady || !eligible.length}
          onClick={() => {
            onSelect(eligible.slice(0, 500));
            resetPreview();
          }}
        >
          Select reviewed cards
        </button>
        <button
          type="button"
          className={button}
          disabled={busy || retrying || !selected.length}
          onClick={() => {
            onSelect([]);
            resetPreview();
          }}
        >
          Clear selection
        </button>
      </div>
      {!draftsReady && <p role="status" className="text-sm">Inventory selection is waiting for browser draft access. Allow browser storage and reload; individual reviews can still be saved.</p>}
      {skipped > 0 && <p role="status" className="text-sm">{skipped} reviewed {skipped === 1 ? "card is" : "cards are"} excluded because of unsaved corrections. Save or cancel them to include them.</p>}
      {selectedBlocked && selected.length > 0 && !retrying && <p role="status" className="text-sm">Selected cards include unsaved corrections. Save or cancel them before adding, or clear the selection and select clean reviewed cards.</p>}
      {retrying && <p role="status" className="text-sm">Recover the original Inventory addition before changing its selection or destination. Retry uses the same saved reviews and request.</p>}
      {eligible.length > 500 && (
        <p className="text-sm">
          Add up to 500 cards per confirmation; the rest stay ready for the next
          one.
        </p>
      )}
      {!stopped && (
        <p className="text-sm">
          Stop capture when you are ready to add cards. Uploads already in
          progress can finish.

        </p>
      )}
      <p className="text-sm"><a className="underline" href="#scan-capture">Go to capture controls</a></p>
      <p className="text-sm">Destination: <strong>{locations.find(location => location.id === locationId)?.name ?? "Choose a location"}{section ? ` · ${section}` : ""}</strong></p>
      <details open={!locationId}>
      <summary className="cursor-pointer text-sm">Change destination</summary>
      <StorageDestinationPicker
        locations={locations}
        locationId={locationId}
        section={section}
        disabled={busy || retrying}
        onLocationChange={(id) => {
          setLocationId(id);
          resetPreview();
        }}
        onSectionChange={(value) => {
          setSection(value);
          resetPreview();
        }}
      />
      </details>
      {!selected.length && eligible.length > 0 && <button className={primary} disabled={busy || retrying || !draftsReady || !stopped || !locationId}
        onClick={() => { const ids = eligible.slice(0, 500); onSelect(ids); void prepare(ids); }}>
        Review {Math.min(eligible.length, 500)} confirmed {eligible.length === 1 ? "card" : "cards"} for Inventory
      </button>}
      <button
        className={button}
        disabled={
          busy ||
          retrying ||
          selectedBlocked ||
          !stopped ||
          !selected.length ||
          !locationId ||
          selected.length > 500
        }
        onClick={() => void prepare()}
      >
        Preview selected cards
      </button>
      {preview && (sameSelection || retrying) && (
        <div
          className="space-y-3 border rounded p-3"
          aria-label="Confirm Inventory addition"
        >
          <p>
            Add{" "}
            <strong>
              {preview.count} {preview.count === 1 ? "copy" : "copies"}
            </strong>{" "}
            to <strong>{preview.destination.name}</strong>
            {preview.destination.section
              ? ` · ${preview.destination.section}`
              : ""}
            .
          </p>
          <p className="text-sm">
            Location: {preview.destination.totalQuantity} currently stored
            {preview.destination.totalCapacity === null
              ? " (no capacity set)"
              : ` / ${preview.destination.totalCapacity} capacity`}
            . Selected section: {preview.destination.sectionQuantity}
            {preview.destination.sectionCapacity === null
              ? " (no section limit)"
              : ` / ${preview.destination.sectionCapacity}`}
            .
          </p>
          <details>
            <summary className="cursor-pointer">
              Check selected card details
            </summary>
            <ul className="text-sm max-h-52 overflow-y-auto break-words">
              {preview.cards.map((c) => (
                <li key={c.photoId}>
                  Card {c.position + 1}: {c.name} ({c.setCode} #
                  {c.collectorNumber}) · {c.finish.toLowerCase()} ·{" "}
                  {c.condition} · {c.language}
                </li>
              ))}
            </ul>
          </details>
          {!!preview.overfill && (
            <div className="space-y-2">
              <p role="alert">
                {preview.overfill} selected{" "}
                {preview.overfill === 1 ? "copy exceeds" : "copies exceed"} the
                remaining capacity. Choose fewer cards or another destination,
                or confirm that they fit.
              </p>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmOverfill}
                  disabled={busy || retrying}
                  onChange={(e) => setConfirmOverfill(e.target.checked)}
                />
                I checked the available physical space.
              </label>
              <label className="block">
                Overfill reason
                <input
                  className={input + " w-full"}
                  value={reason}
                  disabled={busy || retrying}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
          )}
          <p className="text-sm">
            Original opener will be unknown. Photos normally stay for 7 days after
            adding. Completed or trashed batches may be permanently removed sooner
            when scan-photo storage approaches its limit; pending cards keep their photos.
          </p>
          <button
            className={primary}
            disabled={
              busy ||
              (!retrying && selectedBlocked) ||
              (!!preview.overfill &&
                (!confirmOverfill || reason.trim().length < 3))
            }
            onClick={() => void commit()}
          >
            {busy
              ? "Adding..."
              : retrying
                ? "Retry Inventory addition"
                : `Add ${preview.count} ${preview.count === 1 ? "copy" : "copies"} to Inventory`}
          </button>
        </div>
      )}
      {preview && !sameSelection && !retrying && (
        <p role="status">Selection changed. Preview it again before adding.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <p role="status">
          Added {receipt.count} {receipt.count === 1 ? "copy" : "copies"} to
          Inventory.{" "}
          <a className="underline" href="/inventory?source=scan">
            View scanned cards
          </a>
        </p>
      )}
    </section>
  );
}
