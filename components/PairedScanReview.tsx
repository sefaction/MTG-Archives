"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  readPairedScanBatch,
  pairedCatalogChoices,
} from "@/lib/paired-scan-service";
import type { PairedDecision } from "@/lib/paired-scan-policy";
import type { acquisitionProgressDto } from "@/lib/acquisition-api";
import type { StorageLocation } from "@/lib/storage-sections";
import type { AcquisitionOpenerChoice } from "@/lib/acquisition-review";
import { AcquisitionCommitControls } from "./AcquisitionCommitControls";
import { useVisiblePolling } from "./useVisiblePolling";
import {
  artStampSchema,
  scanProfileLabels,
  type ArtStamp,
} from "@/lib/paired-scan-profile";
import {
  filterButtonClass as button,
  filterPrimaryButtonClass as primary,
  filterInputClass as input,
  filterPanelClass as panel,
} from "./filterStyles";
type State = Awaited<ReturnType<typeof readPairedScanBatch>>;
type Choice = ReturnType<typeof pairedCatalogChoices>[number];
type Progress = ReturnType<typeof acquisitionProgressDto>;
type Draft = {
  fingerprint: string | null;
  revision: number;
  front: Choice | null;
  back: Choice | null;
  stamp: ArtStamp;
  artworkSide: "FRONT" | "BACK";
  language: string;
  finish: "NONFOIL" | "FOIL" | "ETCHED";
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  openerPlayerId: string | null;
  photos: string[];
};
async function call<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store", signal },
  );
  const value = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(value.error ?? "Capture request failed. Retry the saved request."),
      { status: r.status },
    );
  return value;
}
export function PairedScanReview({
  batchId,
  userId,
  locations,
  openerChoices,
}: {
  batchId: string;
  userId: string;
  locations: StorageLocation[];
  openerChoices: AcquisitionOpenerChoice[];
}) {
  const prefix = `mtg-paired:${userId}:${batchId}:`,
    pendingKey = prefix + "request";
  const [page, setPage] = useState(0),
    [state, setState] = useState<State | null>(null),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<object | null>(null),
    [rejected, setRejected] = useState(false),
    [blocked, setBlocked] = useState(new Set<string>()),
    [storageReady, setStorageReady] = useState(false),
    [selection, setSelection] = useState<string[]>([]),
    [preview, setPreview] = useState<{ id: number; all: boolean }>(),
    [clearNonce, setClearNonce] = useState(0);
  const [imageHeight, setImageHeight] = useState(280);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const value = Number(localStorage.getItem(`mtg-paired-size:${userId}`));
        if (value >= 200 && value <= 440) setImageHeight(value);
      } catch {
        /* Optional preference. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [userId]);
  const scanDrafts = useCallback(() => {
    try {
      const ids = new Set<string>();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(prefix + "draft:")) {
          const d = JSON.parse(localStorage.getItem(key)!);
          for (const id of d.photos ?? []) ids.add(id);
        }
      }
      setBlocked(ids);
      setStorageReady(true);
    } catch {
      setStorageReady(false);
      setError(
        "Browser storage is unavailable. Enable storage before editing or adding cards.",
      );
    }
  }, [prefix]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(pendingKey);
        if (saved) setPending(JSON.parse(saved));
      } catch {
        setStorageReady(false);
      }
      scanDrafts();
    }, 0);
    const listener = () => scanDrafts();
    window.addEventListener("storage", listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", listener);
    };
  }, [pendingKey, scanDrafts]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const [s, p] = await Promise.all([
          call<State>(
            `/api/acquisition/${batchId}/paired?page=${page}`,
            undefined,
            signal,
          ),
          call<Progress>(`/api/acquisition/${batchId}`, undefined, signal),
        ]);
        if (!signal.aborted) {
          setState(s);
          setProgress(p);
        }
      } catch (e) {
        if (!signal.aborted) setError((e as Error).message);
      }
    },
    [batchId, page],
  );
  const refresh = useVisiblePolling(load, 4000);
  async function act(body: object, draftKey?: string) {
    if (busy || (pending && body !== pending)) return;
    setBusy(true);
    setError("");
    setRejected(false);
    try {
      const frozen = pending ?? {
        ...body,
        ...(draftKey ? { clientDraftKey: draftKey } : {}),
      };
      localStorage.setItem(pendingKey, JSON.stringify(frozen));
      setPending(frozen);
      const { clientDraftKey, ...request } = frozen as Record<string, unknown>;
      await call(`/api/acquisition/${batchId}/paired`, request);
      if (
        typeof clientDraftKey === "string" &&
        clientDraftKey.startsWith(prefix + "draft:")
      )
        localStorage.removeItem(clientDraftKey);
      localStorage.removeItem(pendingKey);
      setPending(null);
      scanDrafts();
      await refresh();
      setClearNonce((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
      setRejected(
        (e as { status?: number }).status === 409 ||
          (e as { status?: number }).status === 403,
      );
    } finally {
      setBusy(false);
    }
  }
  if (!state || !progress)
    return <p role="status">{error || "Loading paired scans…"}</p>;
  const destination = locations.find((l) => l.id === state.locationId),
    scanner = state.scanner,
    settled = !!scanner?.reconciliation,
    feeding = scanner && ["QUEUED", "STARTED"].includes(scanner.status);
  return (
    <div
      className="space-y-4 min-w-0"
      style={
        { "--paired-image-height": `${imageHeight}px` } as React.CSSProperties
      }
    >
      <section className={panel + " space-y-3"}>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Batch {state.batchNumber} · {scanProfileLabels[state.profile]}
            </h2>
            <p>
              Destination:{" "}
              <strong>
                {destination?.name ?? "Unavailable box"}
                {state.section ? ` / ${state.section}` : ""}
              </strong>
            </p>
          </div>
          <button
            className={primary}
            disabled={
              !storageReady || busy || !!pending || !settled || !state.confirmed
            }
            onClick={() => {
              setInventoryOpen(true);
              setPreview({ id: Date.now(), all: true });
              requestAnimationFrame(() =>
                document
                  .getElementById("paired-inventory-addition")
                  ?.scrollIntoView({ block: "start" }),
              );
            }}
          >
            Add {state.confirmed} confirmed to Inventory
          </button>
        </div>
        <p className="text-sm">
          {state.confirmed} confirmed · {state.committed} saved to Inventory
          {state.unresolvedImages
            ? ` · ${state.unresolvedImages} images missing a paired side`
            : ""}
          . Each confirmed pair counts as one physical copy.
        </p>
        {feeding && (
          <>
            <p role="status">
              Scanner {scanner.status.toLowerCase()}. Review waits until capture
              finishes.
            </p>
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                try {
                  await call("/api/scanners/runs", {
                    action: "stop",
                    runId: scanner.id,
                  });
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Stop scanner batch
            </button>
          </>
        )}
        {!feeding && !settled && (
          <TransportClear
            busy={busy || !!pending}
            onConfirm={(reason) =>
              void act({
                action: "settle",
                requestKey: crypto.randomUUID(),
                reason,
                transportAndHopperClear: true,
              })
            }
          />
        )}
        {settled && (
          <a
            className={button}
            href="/imports/scan?input=scanner#new-scan-batch"
          >
            New scanner batch
          </a>
        )}
      </section>
      {pending && (
        <div className={panel + " space-y-2"}>
          <p role="alert">
            A saved request is awaiting acknowledgement. Retry it before making
            another change.
          </p>
          <button
            className={primary}
            disabled={busy}
            onClick={() => void act(pending)}
          >
            Retry saved request
          </button>
          {rejected && (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                localStorage.removeItem(pendingKey);
                setPending(null);
                setRejected(false);
                void refresh();
              }}
            >
              Discard rejected request and refresh
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <label className="flex flex-wrap gap-3 items-center text-sm">
        Image size
        <input
          aria-label="Paired image size"
          type="range"
          min={200}
          max={440}
          step={20}
          value={imageHeight}
          onChange={(e) => {
            const value = Number(e.target.value);
            setImageHeight(value);
            try {
              localStorage.setItem(`mtg-paired-size:${userId}`, String(value));
            } catch {
              /* Optional view preference. */
            }
          }}
        />
        <span>{imageHeight}px</span>
      </label>
      <nav
        className="flex flex-wrap gap-3 items-center"
        aria-label="Paired item navigation"
      >
        <button
          className={button}
          disabled={page <= 0 || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <label>
          Item{" "}
          <input
            aria-label="Item number"
            className={input + " w-24"}
            type="number"
            min={1}
            max={Math.max(1, state.total)}
            value={state.total ? state.page + 1 : 0}
            onChange={(e) =>
              setPage(
                Math.max(
                  0,
                  Math.min(state.total - 1, Number(e.target.value) - 1),
                ),
              )
            }
          />
        </label>
        <span>of {state.total} review entries</span>
        <button
          className={button}
          disabled={state.page + 1 >= state.total || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </nav>
      {state.item ? (
        <PairItem
          key={`${state.item.slotId}:${clearNonce}`}
          state={state}
          batchId={batchId}
          draftKey={prefix + "draft:" + state.item.slotId}
          disabled={busy || !!pending || !settled || !storageReady}
          openerChoices={openerChoices}
          onDraft={scanDrafts}
          onAction={act}
        />
      ) : (
        <p>No saved images yet.</p>
      )}
      <details className={panel}>
        <summary className="cursor-pointer font-semibold">
          Repair pairing
        </summary>
        <p className="text-sm my-3">
          Use the physical cards to verify the images. Unpair an incorrect pair
          first, then choose the two images that belong to one item. This never
          guesses from scan order.
        </p>
        <PairRepair
          state={state}
          batchId={batchId}
          disabled={busy || !!pending || !settled}
          onAction={act}
        />
      </details>
      <section id="paired-inventory-addition" hidden={!inventoryOpen}>
        <button className={button} onClick={() => setInventoryOpen(false)}>
          Close Inventory preview
        </button>
        <AcquisitionCommitControls
          progress={progress}
          locations={locations}
          selected={selection}
          onSelect={setSelection}
          refresh={refresh}
          blockedPhotos={blocked}
          draftsReady={storageReady && !pending && settled}
          canUsePhotos={(ids) =>
            storageReady && !pending && !ids.some((id) => blocked.has(id))
          }
          previewRequest={preview}
        />
      </section>
    </div>
  );
}
function TransportClear({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [checked, setChecked] = useState(false),
    [reason, setReason] = useState("");
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">Settle interrupted capture</legend>
      <p>
        Keep the cards with their scans. Pairing and recognition remain
        unresolved until you review them.
      </p>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        The helper has finished; I removed remaining cards and checked that the
        hopper and transport are clear.
      </label>
      <label className="block">
        What happened?
        <input
          className={input + " block w-full"}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className={button}
        disabled={busy || !checked || !reason.trim()}
        onClick={() => onConfirm(reason)}
      >
        Acknowledge clear transport
      </button>
    </fieldset>
  );
}
function PairItem({
  state,
  batchId,
  draftKey,
  disabled,
  openerChoices,
  onDraft,
  onAction,
}: {
  state: State;
  batchId: string;
  draftKey: string;
  disabled: boolean;
  openerChoices: AcquisitionOpenerChoice[];
  onDraft: () => void;
  onAction: (body: object, draftKey?: string) => Promise<void>;
}) {
  const item = state.item!;
  const savedReview = item.review as Partial<Draft> | null,
    defaults = state.defaults as Partial<Draft> | null;
  const initial = useMemo<Draft>(
    () => ({
      fingerprint: item.sourceFingerprint,
      revision: item.revision,
      front: null,
      back: null,
      stamp: item.saved?.profile === "ART" ? item.saved.stamp : "UNSTAMPED",
      artworkSide:
        item.saved?.profile === "ART" ? item.saved.artworkSide : "FRONT",
      language: savedReview?.language ?? defaults?.language ?? "en",
      finish: savedReview?.finish ?? defaults?.finish ?? "NONFOIL",
      condition: savedReview?.condition ?? defaults?.condition ?? "NM",
      openerPlayerId:
        savedReview?.openerPlayerId ?? defaults?.openerPlayerId ?? null,
      photos: item.photos.map((p) => p.id),
    }),
    [item, defaults, savedReview],
  );
  const [draft, setDraft] = useState(initial),
    [ready, setReady] = useState(false),
    [stored, setStored] = useState(false),
    [checked, setChecked] = useState(false),
    [storageError, setStorageError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          setDraft(JSON.parse(raw));
          setStored(true);
        }
        setReady(true);
      } catch {
        setStorageError(
          "Cannot read saved corrections. Enable browser storage.",
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey]);
  useEffect(() => {
    if (
      !ready ||
      stored ||
      (draft.revision === initial.revision &&
        draft.fingerprint === initial.fingerprint)
    )
      return;
    const timer = setTimeout(() => {
      setDraft(initial);
      setChecked(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, stored, draft.revision, draft.fingerprint, initial]);
  const stale =
    draft.fingerprint !== item.sourceFingerprint ||
    draft.revision !== item.revision;
  function edit(next: Partial<Draft>) {
    const value = { ...draft, ...next };
    try {
      localStorage.setItem(draftKey, JSON.stringify(value));
      setDraft(value);
      setStored(true);
      onDraft();
    } catch {
      setStorageError(
        "Cannot save this correction. Enable browser storage before continuing.",
      );
    }
  }
  function discard() {
    try {
      localStorage.removeItem(draftKey);
      setDraft(initial);
      setStored(false);
      setChecked(false);
      onDraft();
    } catch {
      setStorageError("Cannot clear the saved correction.");
    }
  }
  const source = item.photos.find((p) => p.ready),
    stamp = source
      ? { photoId: source.id, digest: source.digest, revision: item.revision }
      : null;
  const options = (side: string) =>
    state.evidence.find((e) => e.side === side)?.choices ?? [];
  const tokenDecision = () => ({
    profile: "TOKEN" as const,
    front: draft.front
      ? { cardId: draft.front.cardId, face: draft.front.face }
      : item.saved?.profile === "TOKEN"
        ? item.saved.front
        : null,
    back: draft.back
      ? { cardId: draft.back.cardId, face: draft.back.face }
      : item.saved?.profile === "TOKEN"
        ? item.saved.back
        : null,
  });
  const token = tokenDecision(),
    artId =
      draft.front?.cardId ??
      (item.saved?.profile === "ART" ? item.saved.cardId : null),
    valid = state.profile === "TOKEN" ? token.front && token.back : artId;
  return (
    <section className={panel + " space-y-3"} aria-label="Review both sides">
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="font-semibold">
          {item.committed
            ? "Saved to Inventory"
            : item.ignored
              ? "Set aside"
              : item.saved
                ? "Confirmed pair"
                : "Review physical item"}
        </h3>
        {stored && (
          <button className={button} onClick={discard}>
            Discard unsaved changes
          </button>
        )}
      </div>
      {item.problem && (
        <p role="alert">
          Pairing: {item.problem} Use Repair pairing below, or set this item
          aside and rescan both sides in a new batch.
        </p>
      )}
      {stored && stale && (
        <p role="alert">
          The source or saved review changed. Your draft is preserved. Discard
          it and review the current images before confirming.
        </p>
      )}
      {storageError && <p role="alert">{storageError}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {["FRONT", "BACK"].map((side, index) => {
          const photo =
            item.photos.find((p) => p.side === side) ??
            (item.photos.length === 1 && index === 0 ? item.photos[0] : null);
          const savedFace =
            item.saved?.profile === "TOKEN"
              ? index === 0
                ? item.saved.front
                : item.saved.back
              : null;
          const chosen =
            state.profile === "TOKEN"
              ? ((index === 0 ? draft.front : draft.back) ??
                options(side).find(
                  (c) =>
                    c.cardId === savedFace?.cardId && c.face === savedFace.face,
                ))
              : (draft.front ??
                state.evidence
                  .flatMap((e) => e.choices)
                  .find(
                    (c) =>
                      c.cardId ===
                      (item.saved?.profile === "ART"
                        ? item.saved.cardId
                        : null),
                  ));
          const reference =
            state.profile === "TOKEN" || side === draft.artworkSide
              ? chosen?.imageUri
              : chosen?.backImageUri;
          return (
            <div key={side} className="min-w-0 space-y-2">
              <h4 className="font-semibold">
                Scan {index + 1}
                {photo?.side === "UNKNOWN" ? " · side unknown" : ""}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="flex justify-center rounded bg-black/10"
                  style={{ height: "var(--paired-image-height)" }}
                >
                  {photo?.ready ? (
                    <a
                      href={`/api/acquisition/${batchId}/photos/${photo.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex justify-center w-full"
                    >
                      <img
                        alt={`Scanned side ${index + 1}`}
                        className="object-contain max-h-full max-w-full"
                        src={`/api/acquisition/${batchId}/photos/${photo.id}?preview=1`}
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.src.endsWith("?preview=1"))
                            img.src = `/api/acquisition/${batchId}/photos/${photo.id}`;
                        }}
                      />
                    </a>
                  ) : (
                    <p className="self-center">
                      {photo?.purged
                        ? "Original retention ended"
                        : "Waiting for this side"}
                    </p>
                  )}
                </div>
                <div
                  className="flex justify-center items-center rounded bg-black/10"
                  style={{ height: "var(--paired-image-height)" }}
                >
                  {reference ? (
                    <a
                      href={reference}
                      target="_blank"
                      rel="noreferrer"
                      className="flex justify-center w-full h-full"
                    >
                      <img
                        alt={`Selected reference side ${index + 1}`}
                        src={reference}
                        className="object-contain max-h-full max-w-full"
                      />
                    </a>
                  ) : (
                    <p className="text-sm p-2">Choose a printing to compare</p>
                  )}
                </div>
              </div>
              {state.profile === "TOKEN" ? (
                <CatalogPicker
                  batchId={batchId}
                  label={`Token face ${index + 1}`}
                  choices={options(side)}
                  value={index === 0 ? draft.front : draft.back}
                  saved={
                    item.saved?.profile === "TOKEN"
                      ? index === 0
                        ? item.saved.front
                        : item.saved.back
                      : null
                  }
                  disabled={
                    disabled ||
                    stale ||
                    item.committed ||
                    item.ignored ||
                    !ready
                  }
                  onChange={(choice) =>
                    edit(index === 0 ? { front: choice } : { back: choice })
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {state.profile === "ART" && (
        <div className="grid md:grid-cols-3 gap-3">
          <CatalogPicker
            batchId={batchId}
            label="Art-series printing"
            choices={state.evidence.flatMap((e) => e.choices)}
            value={draft.front}
            saved={
              item.saved?.profile === "ART"
                ? { cardId: item.saved.cardId, face: 0 }
                : null
            }
            disabled={
              disabled || stale || item.committed || item.ignored || !ready
            }
            onChange={(front) => edit({ front })}
          />
          <label>
            Stamp
            <select
              className={input + " block w-full"}
              value={draft.stamp}
              disabled={disabled || item.committed || stale}
              onChange={(e) => edit({ stamp: e.target.value as ArtStamp })}
            >
              {artStampSchema.options.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase().replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Artwork is on
            <select
              className={input + " block w-full"}
              value={draft.artworkSide}
              disabled={disabled || item.committed || stale}
              onChange={(e) =>
                edit({ artworkSide: e.target.value as "FRONT" | "BACK" })
              }
            >
              <option value="FRONT">Scan 1</option>
              <option value="BACK">Scan 2</option>
            </select>
          </label>
        </div>
      )}
      {!item.committed && !item.ignored && (
        <>
          <div className="flex flex-wrap gap-3">
            <label>
              Language
              <input
                className={input + " block w-24"}
                value={draft.language}
                maxLength={20}
                disabled={disabled || stale}
                onChange={(e) => edit({ language: e.target.value })}
              />
            </label>
            <label>
              Finish
              <select
                className={input + " block"}
                value={draft.finish}
                disabled={disabled || stale}
                onChange={(e) =>
                  edit({ finish: e.target.value as Draft["finish"] })
                }
              >
                {["NONFOIL", "FOIL", "ETCHED"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select
                className={input + " block"}
                value={draft.condition}
                disabled={disabled || stale}
                onChange={(e) =>
                  edit({ condition: e.target.value as Draft["condition"] })
                }
              >
                {["NM", "LP", "MP", "HP", "DMG"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 max-w-full">
              Original opener
              <select
                className={input + " block max-w-full"}
                value={draft.openerPlayerId ?? ""}
                disabled={disabled || stale}
                onChange={(e) =>
                  edit({ openerPlayerId: e.target.value || null })
                }
              >
                <option value="">Unknown</option>
                {openerChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || stale || !item.sourceFingerprint}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked both images against this one physical item and the
            selected printing{state.profile === "TOKEN" ? "s" : " and stamp"}.
          </label>
          <button
            className={primary}
            disabled={
              disabled ||
              !ready ||
              !checked ||
              stale ||
              !valid ||
              !item.sourceFingerprint ||
              !!storageError
            }
            onClick={() => {
              const decision =
                state.profile === "TOKEN"
                  ? token
                  : {
                      profile: "ART",
                      cardId: artId,
                      artworkSide: draft.artworkSide,
                      stamp: draft.stamp,
                    };
              void onAction(
                {
                  action: "confirm",
                  requestKey: crypto.randomUUID(),
                  slotId: item.slotId,
                  revision: item.revision,
                  sourceFingerprint: item.sourceFingerprint,
                  decision: decision as PairedDecision,
                  attributes: {
                    language: draft.language,
                    finish: draft.finish,
                    condition: draft.condition,
                    openerPlayerId: draft.openerPlayerId,
                  },
                },
                draftKey,
              );
            }}
          >
            Confirm physical item
          </button>
        </>
      )}
      {!item.committed && stamp && (
        <details>
          <summary className="cursor-pointer">More</summary>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              className={button}
              disabled={disabled || stored}
              onClick={() =>
                void onAction({
                  action: item.ignored ? "restore" : "ignore",
                  source: stamp,
                  requestKey: crypto.randomUUID(),
                })
              }
            >
              {item.ignored ? "Restore item" : "Set aside / rescan both sides"}
            </button>
            {!item.ignored && (
              <>
                <button
                  className={button}
                  disabled={disabled || stored || !item.saved}
                  onClick={() =>
                    void onAction({
                      action: "pending",
                      source: stamp,
                      requestKey: crypto.randomUUID(),
                    })
                  }
                >
                  Reopen confirmation
                </button>
                <button
                  className={button}
                  disabled={disabled || stored || item.photos.length !== 2}
                  onClick={() =>
                    void onAction({
                      action: "unpair",
                      source: stamp,
                      requestKey: crypto.randomUUID(),
                    })
                  }
                >
                  Unpair these images
                </button>
              </>
            )}
          </div>
          <p className="text-sm mt-2">
            Set aside keeps the originals and removes this item from Inventory
            addition. To retake, scan both sides in a new explicit batch; old
            and new halves are never mixed automatically.
          </p>
        </details>
      )}
    </section>
  );
}
function CatalogPicker({
  batchId,
  label,
  choices,
  value,
  saved,
  disabled,
  onChange,
}: {
  batchId: string;
  label: string;
  choices: Choice[];
  value: Choice | null;
  saved: { cardId: string; face: number } | null;
  disabled: boolean;
  onChange: (c: Choice) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Choice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const all = [
    ...new Map(
      [...choices, ...results, ...(value ? [value] : [])].map((c) => [
        c.cardId + ":" + c.face,
        c,
      ]),
    ).values(),
  ];
  const chosen =
    value ??
    all.find((c) => c.cardId === saved?.cardId && c.face === saved.face) ??
    null;
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="font-semibold">{label}</legend>
      <select
        className={input + " w-full"}
        value={chosen ? chosen.cardId + ":" + chosen.face : ""}
        onChange={(e) => {
          const c = all.find((c) => c.cardId + ":" + c.face === e.target.value);
          if (c) onChange(c);
        }}
      >
        <option value="">
          {saved && !chosen
            ? "Saved printing · search to change"
            : "Choose a printing"}
        </option>
        {all.map((c) => (
          <option key={c.cardId + ":" + c.face} value={c.cardId + ":" + c.face}>
            {c.name} · {c.setCode.toUpperCase()} #{c.collectorNumber} ·{" "}
            {c.language ?? "unknown language"}
          </option>
        ))}
      </select>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setResults(
              (
                await call<{ choices: Choice[] }>(
                  `/api/acquisition/${batchId}/paired?query=${encodeURIComponent(query)}`,
                )
              ).choices,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label={`Search ${label}`}
          className={input + " min-w-0 flex-1"}
          placeholder="Name, set or collector number"
          value={query}
          maxLength={120}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className={button} disabled={busy || query.trim().length < 2}>
          Find printing
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
function PairRepair({
  state,
  batchId,
  disabled,
  onAction,
}: {
  state: State;
  batchId: string;
  disabled: boolean;
  onAction: (body: object) => Promise<void>;
}) {
  const [front, setFront] = useState(""),
    [back, setBack] = useState(""),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false);
  const source = (id: string) =>
    state.repairSources.find((p) => p.photoId === id);
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <div className="grid md:grid-cols-2 gap-4">
        {[
          { label: "First source", id: front, set: setFront },
          { label: "Second source", id: back, set: setBack },
        ].map((field) => (
          <div key={field.label}>
            <label>
              {field.label}
              <select
                className={input + " block w-full"}
                value={field.id}
                onChange={(e) => {
                  field.set(e.target.value);
                  setChecked(false);
                }}
              >
                <option value="">Choose image</option>
                {state.repairSources.map((p) => (
                  <option key={p.photoId} value={p.photoId}>
                    Entry {p.position + 1} · {p.side} · {p.photoId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {field.id && (
              <img
                alt={field.label}
                src={`/api/acquisition/${batchId}/photos/${field.id}`}
                className="h-48 w-full object-contain"
              />
            )}
          </div>
        ))}
      </div>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        These two images are opposite sides of the same physical item.
      </label>
      <label className="block">
        Reason for repair
        <input
          className={input + " block w-full"}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className={button}
        disabled={
          !checked ||
          !reason.trim() ||
          !source(front) ||
          !source(back) ||
          front === back
        }
        onClick={() => {
          const stamp = (id: string) => {
            const p = source(id)!;
            return {
              photoId: p.photoId,
              digest: p.digest,
              revision: p.revision,
            };
          };
          void onAction({
            action: "link",
            requestKey: crypto.randomUUID(),
            front: stamp(front),
            back: stamp(back),
            reason,
            samePhysicalItem: true,
          });
        }}
      >
        Pair these two images
      </button>
    </fieldset>
  );
}
