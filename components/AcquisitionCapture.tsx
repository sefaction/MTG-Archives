"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScannerContinuation } from "@/lib/scanner-continuation";
import { readScannerStart, saveScannerStart, clearScannerStart, type PendingScannerStart } from "@/lib/scanner-browser-start";
import { AcquisitionCommitControls } from "./AcquisitionCommitControls";
import { ScannerSourceFields, ScannerRunControls, type ScannerChoice } from "./ScannerBatchControls";
import { AcquisitionBulkReview } from "./AcquisitionBulkReview";
import { useAcquisitionDrafts } from "./useAcquisitionDrafts";
import { acquisitionDraftKey } from "@/lib/acquisition-browser-review-draft";
import { SCANNER_CAPTURE_PROVIDER } from "@/lib/scanner-run-protocol";
import { StorageDestinationPicker } from "./StorageDestinationPicker";
import {
  AcquisitionBatchDefaults,
  AcquisitionPhotoReview,
} from "./AcquisitionReviewControls";
import {
  filterButtonClass as button,
  filterPrimaryButtonClass as primary,
  filterInputClass as input,
  filterPanelClass as panel,
} from "./filterStyles";
import type { StorageLocation } from "@/lib/storage-sections";
import {
  acquisitionImageInputKindSchema,
  type AcquisitionImageInputKind,
} from "@/lib/acquisition-image-input";
import type { acquisitionProgressDto } from "@/lib/acquisition-api";
import {
  acquisitionReviewCounts,
  acquisitionSlotReviewState,
  nextAwaitingAcquisitionSlot,
  type AcquisitionReviewMode,
  type AcquisitionReviewFilter,
} from "@/lib/acquisition-review-display";
import {
  ACQUISITION_UPLOAD_ATTEMPTS,
  uploadAcquisitionPhoto,
  reserveAcquisitionPhotoSlot,
} from "@/lib/acquisition-upload";
import {
  captureUuid,
  loadPendingPhotos,
  removePendingPhoto,
  savePendingPhoto,
  type PendingPhoto,
} from "@/lib/acquisition-browser-queue";
type Progress = ReturnType<typeof acquisitionProgressDto>;
type Upload = PendingPhoto & {
  status: "queued" | "uploading" | "failed";
  error?: string;
  retry?: number;
};
const pendingPhotoLimit = 10;
function validatePhoto(blob: Blob) {
  if (
    blob.size > 10 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(blob.type)
  )
    throw new Error(
      "Choose JPEG, PNG or WebP photos under 10 MB. Convert HEIC to JPEG or use the in-app camera.",
    );
}
async function request<T>(url: string, value?: unknown): Promise<T> {
  const response = await fetch(
    url,
    value === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed; retry");
  return result;
}
export function AcquisitionCapture({
  userId,
  locations,
  initialBatch,
  initialScanner,
  photoInput,
  recent,
  initialSetup = null,
  setupMessage = "",
}: {
  userId: string;
  locations: StorageLocation[];
  initialBatch: string;
  initialScanner: boolean;
  photoInput?: "camera" | "photos";
  recent: { id: string; batchNumber: number; phase: string }[];
  initialSetup?: ScannerContinuation | null;
  setupMessage?: string;
}) {
  const [locationId, setLocationId] = useState(initialSetup?.locationId ?? "");
  const [section, setSection] = useState(initialSetup?.section ?? "");
  const router = useRouter(), [refreshingCapacity, refreshCapacity] = useTransition();
  const [quantity, setQuantity] = useState(1);
  const [customLimit, setCustomLimit] = useState(false);
  const [scannerChoice, setScannerChoice] = useState<ScannerChoice | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(initialScanner);
  const [scannerDetecting, setScannerDetecting] = useState(false);
  const pendingStart = useRef<PendingScannerStart | null>(null);
  const [pendingScanner, setPendingScanner] = useState<PendingScannerStart | null>(null);
  const [retiredSetup, setRetiredSetup] = useState<PendingScannerStart | null>(null);
  const [setupNotice, setSetupNotice] = useState("");
  const setupDefaults = retiredSetup?.defaults ?? initialSetup?.defaults;
  const [checkingStart, setCheckingStart] = useState(true);
  const [startStorageError, setStartStorageError] = useState(false);
  const sourceIdentity = useRef("");
  const scannerChanged = useCallback((value: ScannerChoice | null, enabled: boolean, detecting = false) => {
    setScannerDetecting(detecting);
    if (pendingStart.current) return;
    const identity = JSON.stringify({ value, enabled });
    if (sourceIdentity.current !== identity) createKey.current = "";
    sourceIdentity.current = identity;
    setScannerChoice(value); setScannerEnabled(enabled); if (enabled) setCustomLimit(false);
  }, []);
  const [batchId, setBatchId] = useState(initialBatch);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [uploads, setUploadState] = useState<Upload[]>([]);
  const [imageInputKind, setImageInputKind] =
    useState<AcquisitionImageInputKind>("PHOTO");
  const pendingUploads = useRef<Upload[]>([]);
  const setUploads = useCallback(
    (update: Upload[] | ((rows: Upload[]) => Upload[])) => {
      const next =
        typeof update === "function" ? update(pendingUploads.current) : update;
      pendingUploads.current = next;
      setUploadState(next);
    },
    [],
  );
  const [selection, setSelection] = useState<{
    added: number;
    total: number;
  } | null>(null);
  const stopSelection = useRef(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [reviewMode, setReviewMode] = useState<AcquisitionReviewMode>("simple");
  const [reviewFilter, setReviewFilter] =
    useState<AcquisitionReviewFilter>("all");
  const [dirtyPhotos, setDirtyPhotos] = useState<Set<string>>(() => new Set());
  const dirtyNow = useRef(new Set<string>());
  const cachedDrafts = useAcquisitionDrafts(userId, batchId);
  const blockedPhotos = new Set([...cachedDrafts.ids, ...dirtyPhotos]);
  const markPhotoDirty = useCallback((photoId: string, dirty: boolean) => {
    if (dirty) dirtyNow.current.add(photoId); else dirtyNow.current.delete(photoId);
    setDirtyPhotos((previous) => {
      if (previous.has(photoId) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);
  const canUsePhotos = useCallback((ids: string[]) => {
    // Read only the requested cards again immediately before a write. A storage
    // notification may not yet have rendered; a failed write still has live edits.
    try {
      return ids.every(photoId => !dirtyNow.current.has(photoId) &&
        localStorage.getItem(acquisitionDraftKey({ userId, batchId, photoId })) === null);
    } catch { return false; }
  }, [userId, batchId]);
  const hasDraft = (slot: Progress["slots"][number]) => slot.photos.some(photo => blockedPhotos.has(photo.id));
  const reviewCounts = acquisitionReviewCounts(progress?.slots ?? [], hasDraft);
  const filteredSlots = (progress?.slots ?? []).filter(
    (slot) =>
      reviewFilter === "all" ||
      acquisitionSlotReviewState(slot, hasDraft(slot)) === reviewFilter,
  );
  const visibleIds = new Set(
    filteredSlots.slice(0, visibleCount).map((s) => s.id),
  );
  const shownSlots = (progress?.slots ?? []).filter(
    (slot) =>
      visibleIds.has(slot.id) || slot.photos.some((p) => dirtyPhotos.has(p.id)),
  );
  const [reviewNavigation, setReviewNavigation] = useState("");
  function nextAwaitingReview(after: number) {
    const next = nextAwaitingAcquisitionSlot(progress?.slots ?? [], after, hasDraft);
    if (!next) { setReviewNavigation("No other cards awaiting review."); return; }
    setReviewNavigation(`Card ${next.position + 1} awaiting review.`);
    setReviewFilter("all");
    setVisibleCount(count => Math.max(count, next.position + 1));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = document.getElementById(`capture-card-${next.position + 1}`);
      row?.scrollIntoView({ block: "start" }); row?.focus({ preventScroll: true });
    }));
  }
  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        `mtg-acquisition-review-mode:${userId}`,
      );
      setReviewMode(saved === "advanced" ? "advanced" : "simple");
    } catch {
      /* The review remains usable without browser storage. */
    }
  }, [userId]);
  useEffect(() => {
    setVisibleCount(12);
  }, [batchId]);
  useEffect(() => {
    dirtyNow.current.clear();
    setDirtyPhotos(new Set());
    setReviewNavigation("");
  }, [batchId]);
  const moreCards = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setVisibleCount((n) => Math.min(n + 12, filteredSlots.length));
      },
      { rootMargin: "600px" },
    );
    if (moreCards.current) observer.observe(moreCards.current);
    return () => observer.disconnect();
  }, [visibleCount, filteredSlots.length]);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  function showInventory() {
    setInventoryOpen(true);
    requestAnimationFrame(() => document.getElementById("scan-inventory")?.scrollIntoView({ block: "start" }));
  }
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const tasks = useRef(new Set<string>()),
    mounted = useRef(true),
    capturing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null),
    replacement = useRef<Progress["slots"][number] | null>(null);
  const createKey = useRef("");
  const adoptScanner = useCallback((state: Progress, intent: PendingScannerStart) => {
    if (!mounted.current) return;
    if (state.runId !== intent.requestKey || state.providerId !== SCANNER_CAPTURE_PROVIDER)
      throw new Error("Scanner batch recovery did not match. Keep this page open and retry.");
    setProgress(state); setBatchId(state.id); setError("");
    history.replaceState(null, "", `/imports/scan?batch=${state.id}`);
    try { clearScannerStart(sessionStorage, userId, intent.requestKey); } catch { /* Same intent can safely recover again. */ }
    pendingStart.current = null; setPendingScanner(null);
  }, [userId]);
  const recoverScanner = useCallback(async (intent: PendingScannerStart) => {
    const result = await request<{ found: boolean; progress: Progress | null }>(`/api/scanners/runs?request=${intent.requestKey}`);
    if (result.found && result.progress) { adoptScanner(result.progress, intent); return true; }
    return false;
  }, [adoptScanner]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (initialBatch || photoInput) return;
        const intent = readScannerStart(sessionStorage, userId);
        if (!intent) return;
        pendingStart.current = intent; createKey.current = intent.requestKey;
        setPendingScanner(intent); setScannerEnabled(true);
        setLocationId(intent.locationId); setSection(intent.section);
        if (!await recoverScanner(intent) && active)
          setError("The previous Start has not been found yet. Retry the same scanner start to check again and finish that request.");
      } catch {
        if (active) {
          // Photo input does not require scanner-start storage. A scanner start
          // still refuses to send if its durable intent cannot be saved.
          if (!initialScanner && !pendingStart.current) return;
          if (!pendingStart.current) setStartStorageError(true);
          setError(pendingStart.current ? "Cannot check the previous scanner start. Reconnect, then retry the same scanner start." :
            "This browser could not read its saved scanner start. Enable browser storage before starting; existing batches are available in Recent batches.");
        }
      } finally { if (active) setCheckingStart(false); }
    })();
    return () => { active = false; };
  }, [userId, initialBatch, initialScanner, photoInput, recoverScanner]);
  const destination = locations.find((l) => l.id === locationId);
  const selectedSection = destination?.sections.find((s) => s.name === section);
  const limits = [
    destination?.capacity == null
      ? null
      : Math.max(0, destination.capacity - (destination.quantity ?? 0)),
    selectedSection?.capacity == null
      ? null
      : Math.max(0, selectedSection.capacity - selectedSection.quantity),
  ].filter((n): n is number => n !== null);
  const remaining = limits.length ? Math.min(...limits) : null;
  useEffect(() => {
    setQuantity(remaining ?? 1);
  }, [locationId, section, remaining]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!batchId) return;
    try {
      const state = await request<Progress>(`/api/acquisition/${batchId}`);
      if (mounted.current) setProgress(state);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }, [batchId]);
  useEffect(() => {
    if (!batchId) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [batchId, refresh]);
  useEffect(() => {
    if (!batchId) return;
    let active = true;
    loadPendingPhotos(userId, batchId)
      .then((rows) => {
        if (active)
          setUploads(rows.map((row) => ({ ...row, status: "queued" })));
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [userId, batchId, setUploads]);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current
        .play()
        .catch(() => setError("Tap the camera preview to start it"));
    }
  }, [camera]);
  useEffect(() => {
    for (const row of uploads) {
      if (
        row.status !== "queued" ||
        tasks.current.has(row.key) ||
        tasks.current.size >= 2
      )
        continue;
      tasks.current.add(row.key);
      setUploads((all) =>
        all.map((p) => (p.key === row.key ? { ...p, status: "uploading" } : p)),
      );
      void (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          // A browser crash before ACK retains this blob and the same upload identity.
          await savePendingPhoto(row);
          const url = `/api/acquisition/${row.sessionId}/photos?slot=${row.slotId}&key=${row.key}&generation=${row.generation}&replace=${row.replacePending ? "1" : "0"}&inputKind=${row.inputKind ?? "PHOTO"}`;
          await uploadAcquisitionPhoto(url, row.blob, {
            signal: controller.signal,
            onRetry: (retry) => {
              if (mounted.current)
                setUploads((all) =>
                  all.map((p) => p.key === row.key ? { ...p, retry } : p),
                );
            },
          });
          await removePendingPhoto(row.key);
          if (mounted.current) {
            setUploads((all) => all.filter((p) => p.key !== row.key));
            await refresh();
          }
        } catch (e) {
          if (mounted.current)
            setUploads((all) =>
              all.map((p) =>
                p.key === row.key
                  ? { ...p, status: "failed", error: (e as Error).message }
                  : p,
              ),
            );
        } finally {
          clearTimeout(timeout);
          tasks.current.delete(row.key);
          // Release the HTTP slot before waking queued uploads. A completed
          // request's earlier state update may have run while both slots were held.
          if (mounted.current) setUploads((all) => [...all]);
        }
      })();
    }
  }, [uploads, refresh, setUploads]);
  async function start() {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    setError("");
    try {
      if (pendingStart.current) {
        const intent = pendingStart.current;
        if (await recoverScanner(intent)) return;
        const state = await request<Progress>("/api/scanners/runs", { ...intent, action: "create" });
        adoptScanner(state, intent); return;
      }
      if (!createKey.current) createKey.current = captureUuid();
      const value = {
        ...(scannerChoice ? { ...scannerChoice, action: "create" } : {}),
        ...(scannerChoice && setupDefaults ? { defaults: setupDefaults } : {}),
        requestKey: createKey.current,
        locationId,
        section,
        quantity: customLimit ? quantity : null,
      };
      if (scannerChoice) {
        const { action: _action, ...intent } = value;
        try { saveScannerStart(sessionStorage, userId, intent as PendingScannerStart); }
        catch { throw new Error("This browser cannot save a scanner start. Enable browser storage and retry; no scan command was sent."); }
        pendingStart.current = intent as PendingScannerStart; setPendingScanner(pendingStart.current);
      }
      const state = await request<Progress>(scannerChoice ? "/api/scanners/runs" : "/api/acquisition", value);
      if (pendingStart.current) { adoptScanner(state, pendingStart.current); return; }
      setProgress(state);
      setBatchId(state.id);
      history.replaceState(null, "", `/imports/scan?batch=${state.id}${photoInput ? `&input=${photoInput}` : ""}`);
    } catch (e) {
      if (pendingStart.current) {
        try { if (await recoverScanner(pendingStart.current)) return; } catch { /* Uncertain result keeps original intent. */ }
        setError(`${(e as Error).message}. The original Start is saved. Retry the same scanner start; it will recover an accepted batch first.`);
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
      capturing.current = false;
    }
  }
  async function changeScannerSetup() {
    const intent = pendingStart.current;
    if (!intent || capturing.current) return;
    capturing.current = true; setBusy(true); setError("");
    try {
      const result = await request<{ retired: boolean; partialBatchId?: string | null; progress?: Progress }>(
        "/api/scanners/runs", { ...intent, action: "retire" });
      if (!mounted.current || pendingStart.current !== intent) return;
      if (!result.retired) {
        if (!result.progress) throw new Error("Cannot recover this Start. Keep the original request and retry.");
        adoptScanner(result.progress, intent); return;
      }
      const saved = readScannerStart(sessionStorage, userId);
      if (saved && saved.requestKey !== intent.requestKey)
        throw new Error("Cannot change setup: this tab saved a different Start. Reload to recover it.");
      clearScannerStart(sessionStorage, userId, intent.requestKey);
      if (readScannerStart(sessionStorage, userId)) throw new Error("Cannot clear the cancelled Start. Allow browser storage and retry.");
      pendingStart.current = null; createKey.current = ""; setPendingScanner(null);
      setRetiredSetup(intent); setSetupNotice(result.partialBatchId
        ? "The unfinished empty batch was cancelled. Choose your setup, then start a new batch."
        : "The previous Start was cancelled. Choose your setup, then start a new batch.");
      refreshCapacity(() => router.refresh());
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { capturing.current = false; if (mounted.current) setBusy(false); }
  }
  async function openCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "The in-app camera needs a secure HTTPS connection. Photo library upload is available here.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 2560 },
        },
        audio: false,
      });
      setCamera(true);
      setError("");
    } catch (e) {
      setError(
        (e as Error).message === "Permission denied"
          ? "Camera permission was denied. Allow it in your browser or use Photo library."
          : (e as Error).message,
      );
    }
  }
  async function addPhoto(
    blob: Blob,
    slot?: Progress["slots"][number],
    inputKind = imageInputKind,
  ) {
    validatePhoto(blob);
    const admitted =
      slot ??
      (
        await reserveAcquisitionPhotoSlot<{ slot: Progress["slots"][number] }>(
          `/api/acquisition/${batchId}`,
          captureUuid(),
        )
      ).slot;
    const row: Upload = {
      key: captureUuid(),
      userId,
      sessionId: batchId,
      slotId: admitted.id,
      generation: admitted.generation,
      replacePending: !!slot,
      inputKind,
      blob,
      status: "queued",
    };
    await savePendingPhoto(row);
    setUploads((all) => [...all, row]);
    await refresh();
  }
  async function capture(slot?: Progress["slots"][number]) {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    setError("");
    try {
      if (!video.current?.videoWidth)
        throw new Error("Wait for the camera preview");
      const canvas = document.createElement("canvas"),
        scale = Math.min(
          1,
          2560 / Math.max(video.current.videoWidth, video.current.videoHeight),
        );
      canvas.width = Math.round(video.current.videoWidth * scale);
      canvas.height = Math.round(video.current.videoHeight * scale);
      canvas
        .getContext("2d")!
        .drawImage(video.current, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Could not take photo"))),
          "image/jpeg",
          0.92,
        ),
      );
      await addPhoto(blob, slot, "PHOTO");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      capturing.current = false;
    }
  }
  async function chooseFiles(files: FileList | null) {
    if (!files?.length || capturing.current) return;
    const selected = Array.from(files);
    capturing.current = true;
    stopSelection.current = false;
    setBusy(true);
    setError("");
    const slot = replacement.current;
    replacement.current = null;
    try {
      const available = slot ? 1 : (progress?.availableSlots ?? Infinity);
      if (selected.length > available)
        throw new Error(
          slot
            ? "Choose one replacement photo."
            : `This batch has ${available} spaces remaining. Select up to ${available} photos.`,
        );
      for (const file of selected) {
        try {
          validatePhoto(file);
        } catch (e) {
          throw new Error(`${file.name}: ${(e as Error).message}`);
        }
      }
      setSelection({ added: 0, total: selected.length });
      let added = 0;
      for (const file of selected) {
        // Keep only a bounded number of admitted blobs in browser storage/state.
        // File handles for the remaining selection need no decoding or read-ahead.
        while (
          pendingUploads.current.length >= pendingPhotoLimit &&
          mounted.current &&
          !stopSelection.current
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        if (!mounted.current) return;
        if (stopSelection.current) {
          setError(
            `Stopped adding photos. ${added} of ${selected.length} were queued; select the remaining ${selected.length - added} when ready.`,
          );
          break;
        }
        await addPhoto(file, slot ?? undefined);
        added++;
        setSelection({ added, total: selected.length });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSelection(null);
      setBusy(false);
      capturing.current = false;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function control(command: "START" | "STOP" | "RESUME") {
    if (!progress) return;
    setBusy(true);
    try {
      setProgress(
        await request<Progress>(`/api/acquisition/${batchId}`, {
          action: "control",
          requestKey: captureUuid(),
          revision: progress.revision,
          command,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const readyPhotos =
    progress?.slots.filter((s) => s.photos.some((p) => p.ready)).length ?? 0;
  const prepared =
    progress?.photoPreparation.filter((p) => p.status === "COMPLETE").length ??
    0;
  const canAdd =
    progress?.phase === "CAPTURING" &&
    progress.destinationCurrent &&
    (progress.availableSlots === null || progress.availableSlots > 0) &&
    uploads.length < pendingPhotoLimit;
  return (
    <div className="space-y-4 min-w-0">
      {error && !progress && (
        <div role="alert" className={panel}>
          {error}
        </div>
      )}
      {!batchId ? (
        <section id="new-scan-batch" className={panel + " scroll-mt-4"} aria-label="New scan batch">
          <h2 className="text-xl font-semibold mb-3">
            {photoInput ? "Set up a new photo batch" : "Set up a new scan batch"}
          </h2>
          {!setupMessage && <p className="text-sm mb-3">{photoInput === "camera" ? "Choose a destination and start a batch, then open your camera to photograph cards." : photoInput === "photos" ? "Choose a destination and start a batch, then select card photos from this computer or your phone's photo library." : "Choose a destination and card input below. Starting a scanner batch sends the scan command to the connected computer."}</p>}
          {setupMessage && <p className="text-sm mb-3" role="status">{setupMessage}</p>}
          {setupDefaults && scannerEnabled && <p className="text-sm mb-3">Batch defaults: {setupDefaults.finish.toLowerCase()} · {setupDefaults.condition ?? "condition not set"}. You can change these during review.</p>}
          <div className="grid gap-4 lg:grid-cols-2 items-start"><div className="min-w-0">
          <StorageDestinationPicker
            disabled={busy || checkingStart || !!pendingScanner || startStorageError}
            locations={locations}
            locationId={locationId}
            onLocationChange={(id) => {
              setLocationId(id);
              createKey.current = "";
            }}
            section={section}
            capacityHint="Capacity is checked when the batch starts."
            onSectionChange={(value) => {
              setSection(value);
              createKey.current = "";
            }}
          />
          {!scannerEnabled && <label className="block my-3">
            <input
              type="checkbox"
              disabled={busy || checkingStart || !!pendingScanner || startStorageError}
              checked={customLimit}
              onChange={(e) => {
                setCustomLimit(e.target.checked);
                createKey.current = "";
              }}
            />{" "}
            Set a batch limit (optional)
          </label>}
          {!scannerEnabled && customLimit && (
            <label className="block my-3">
              Cards in this batch{" "}
              <input
                className={input + " ml-2 w-24"}
                type="number"
                disabled={busy || checkingStart || !!pendingScanner || startStorageError}
                min={1}
                max={remaining ?? undefined}
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  createKey.current = "";
                }}
              />
            </label>
          )}
          <p className="text-sm mb-3">
            {remaining === null
              ? scannerEnabled ? "No capacity set. The scanner runs until the feeder is empty and shows the saved image count." : photoInput ? "This location has no capacity set. Keep adding photos and watch the running count, then stop when finished." : "This location has no capacity set. Keep scanning and watch the running count, then stop when finished."
              : scannerEnabled ? `${remaining} spaces remain. Load no more than that; the scanner runs until the feeder is empty.` : `${remaining} spaces remaining in this destination.`}{" "}
            {!scannerEnabled && "One card per photo."}
          </p>
          <button className={button+" mb-3"} disabled={busy || checkingStart || !!pendingScanner || refreshingCapacity} onClick={()=>refreshCapacity(()=>router.refresh())}>
            {refreshingCapacity ? "Refreshing capacity…" : "Refresh capacity"}
          </button>
          <details className="text-sm mb-3"><summary className="cursor-pointer">About capacity</summary>
            <p className="mt-2">Capacity shown here includes stored cards. Pending batches and capacity are checked again before {photoInput ? "the batch starts" : "the scanner starts"} and before Inventory addition.</p>
          </details>
          </div><div className="min-w-0">
          {photoInput ? <p className="text-sm my-3">One card per photo. JPEG, PNG and WebP are supported. Review the saved cards before adding them to Inventory.</p> : <ScannerSourceFields key={pendingScanner?.requestKey ?? "setup"} initialEnabled={pendingScanner || retiredSetup ? true : initialScanner} initialChoice={pendingScanner ?? retiredSetup ?? initialSetup?.scanner} onChange={scannerChanged} disabled={busy || checkingStart || !!pendingScanner || startStorageError || refreshingCapacity} remaining={customLimit ? Math.min(quantity,remaining??quantity) : remaining} />}
          </div></div>
          <button
            className={primary}
            disabled={
              busy || checkingStart || startStorageError || refreshingCapacity || (!pendingScanner && (
              !destination ||
              (scannerEnabled && !scannerChoice) ||
              remaining === 0 ||
              (customLimit &&
                (quantity < 1 || (remaining !== null && quantity > remaining)))))
            }
            onClick={() => void start()}
          >
            {checkingStart ? "Checking previous start…" : pendingScanner ? "Retry same scanner start" : scannerEnabled ? "Start scanner batch" : "Start batch"}
          </button>
          {pendingScanner && <div className="space-y-2 mt-2">
            <p className="text-sm" role="status">Retry checks the original Start. To change destination or settings, cancel that request first. If it was accepted, its batch opens instead.</p>
            <button className={button} disabled={busy || checkingStart} onClick={() => void changeScannerSetup()}>Change scanner setup</button>
          </div>}
          {setupNotice && <p className="text-sm mt-2" role="status">{setupNotice}</p>}
          {!pendingScanner && !locationId && <p className="text-sm mt-2" role="status">Choose a destination to start.</p>}
          {!pendingScanner && locationId && remaining === 0 && <p className="text-sm mt-2" role="status">This destination has no remaining space. Choose another destination.</p>}
          {!pendingScanner && locationId && scannerEnabled && !scannerChoice && remaining !== 0 && <p className="text-sm mt-2" role="status">{scannerDetecting
            ? "Waiting for scanner detection to finish. Your destination and source choice are kept."
            : "Choose an online scanner source to enable Start scanner batch."}</p>}
          {!!recent.length && (
            <div className="mt-4">
              <h3 className="font-semibold">Recent batches</h3>
              <ul>
                {recent.map((r) => (
                  <li key={r.id}>
                    <a
                      className="underline"
                      href={`/imports/scan?batch=${r.id}`}
                    >
                      Batch {r.batchNumber} · {r.phase.toLowerCase()}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : !progress ? (
        <p role="status">Loading batch...</p>
      ) : (
        <>
          <section
            className={panel + " sticky top-0 z-10"}
            style={{ background: "var(--app-surface)" }}
            aria-label="Batch progress"
          >
            <h2 className="text-xl font-semibold">
              Batch {progress.batchNumber} · {progress.reservedSlots}
              {progress.providerId === SCANNER_CAPTURE_PROVIDER ? ` ${progress.reservedSlots === 1 ? "image" : "images"}` : progress.target === null
                ? " cards"
                : ` of ${progress.target} cards`}
            </h2>
            <p role="status" aria-live="polite">
              {uploads.filter((p) => p.status !== "failed").length} uploading ·{" "}
              {readyPhotos} {readyPhotos === 1 ? "photo" : "photos"} saved · {prepared} {prepared === 1 ? "photo" : "photos"} prepared
            </p>
            <p className="text-sm">
              {reviewCounts.ready} ready for Inventory ·{" "}
              {reviewCounts.awaiting} awaiting review · {reviewCounts.added} added
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2" aria-label="Batch actions">
            {!!readyPhotos && !bulkOpen && (
              <a className={button + " inline-flex text-sm"} href="#scan-review">
                Review saved cards
              </a>
            )}
            {cachedDrafts.ready && reviewCounts.ready > 0 && <a className={primary + " inline-flex max-w-full text-sm whitespace-normal"} href="#scan-inventory" onClick={event => { event.preventDefault(); showInventory(); }}>
              Add {reviewCounts.ready} confirmed {reviewCounts.ready === 1 ? "card" : "cards"} to Inventory
            </a>}
            </div>
            <p className="text-xs text-[var(--app-muted)]">
              {progress.providerId === SCANNER_CAPTURE_PROVIDER ? "Check for missed or doubled cards before adding reviewed matches to Inventory." : progress.availableSlots === 0
                ? "Batch full. You can still retry or retake a photo."
                : progress.availableSlots === null
                  ? "No capacity limit set. Stop capture when finished."
                  : `${progress.availableSlots} cards remaining.`}
            </p>
            {selection && (
              <p role="status" className="text-sm mt-2">
                Adding {selection.added} of {selection.total} selected photos
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2">
                {error}
              </p>
            )}
          </section>
          {!progress.destinationCurrent && (
            <p role="alert">
              The destination changed. Saved photos are retained; choose a new
              batch destination before taking more.
            </p>
          )}
          {progress.providerId === SCANNER_CAPTURE_PROVIDER ? <ScannerRunControls runId={progress.runId} savedImages={readyPhotos} refresh={refresh} /> : <section className={panel} aria-label="Card camera">
            <p className="mb-2">
              Photograph one card at a time, with the whole front visible and as
              little glare as possible.
            </p>
            {camera && (
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => setCameraReady(true)}
                className="w-full max-h-[45dvh] bg-black rounded-md"
                aria-label="Card camera preview"
                onClick={() => void video.current?.play()}
              />
            )}
            <label className="block mt-3">
              Library image type
              <select
                className={input + " mt-1 w-full sm:w-auto sm:ml-2"}
                value={imageInputKind}
                disabled={busy}
                onChange={(e) =>
                  setImageInputKind(
                    acquisitionImageInputKindSchema.parse(e.target.value),
                  )
                }
              >
                <option value="PHOTO">Photo · detect card border</option>
                <option value="CARD_SCAN">Card scan · preserve card edges</option>
              </select>
            </label>
            <p className="text-sm mt-1">
              {imageInputKind === "CARD_SCAN"
                ? "One card per image. Clear outer edges are aligned for reading; incomplete edges need a new scan. Your original is kept."
                : "Use for camera photos with background around the card. In-app camera captures always use Photo."}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {!camera ? (
                <button className={button} onClick={() => void openCamera()}>
                  Open camera
                </button>
              ) : (
                <>
                  <button
                    className={primary}
                    disabled={!canAdd || busy || !cameraReady}
                    onClick={() => void capture()}
                  >
                    Take photo
                  </button>
                  <button
                    className={button}
                    onClick={() => {
                      stream.current?.getTracks().forEach((t) => t.stop());
                      stream.current = null;
                      setCamera(false);
                      setCameraReady(false);
                    }}
                  >
                    Close camera
                  </button>
                </>
              )}
              <button
                className={button}
                disabled={!canAdd || busy}
                onClick={() => {
                  replacement.current = null;
                  fileInput.current?.click();
                }}
              >
                Photo library
              </button>
              {progress.phase === "DRAFT" && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void control("START")}
                >
                  Start capture
                </button>
              )}
              {progress.phase === "CAPTURING" && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void control("STOP")}
                >
                  Stop capture
                </button>
              )}
              <a className={button} href={photoInput ? `/imports/scan?input=${photoInput}` : "/imports/scan"}>
                New batch
              </a>
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              aria-label="Choose card photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => void chooseFiles(e.target.files)}
            />
            {selection && (
              <div className="mt-3">
                <p className="text-sm">
                  Keep this page open while the selected photos are added. Saved
                  photos are processed in the background.
                </p>
                <button
                  className={button + " mt-2"}
                  onClick={() => {
                    stopSelection.current = true;
                  }}
                >
                  Stop adding photos
                </button>
              </div>
            )}
            {uploads.length >= pendingPhotoLimit && (
              <p role="status">
                Waiting for uploads before taking more photos.
              </p>
            )}
          </section>}
          {!!uploads.length && (
            <section className={panel} aria-label="Pending uploads">
              <h3 className="font-semibold">Uploads</h3>
              <ul className="space-y-2">
                {uploads.map((row) => (
                  <li key={row.key}>
                    Photo{" "}
                    {(progress.slots.find((s) => s.id === row.slotId)
                      ?.position ?? 0) + 1}
                    : {row.status === "failed" ? row.error : row.retry
                      ? `Retrying upload (${row.retry} of ${ACQUISITION_UPLOAD_ATTEMPTS - 1})`
                      : row.status}
                    {row.status === "failed" && (
                      <button
                        className={button + " ml-2"}
                        onClick={() =>
                          setUploads((all) =>
                            all.map((p) =>
                              p.key === row.key
                                ? { ...p, status: "queued", error: undefined, retry: undefined }
                                : p,
                            ),
                          )
                        }
                      >
                        Retry upload
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <details className="min-w-0" open={reviewMode === "advanced"}>
          <summary className="cursor-pointer text-sm">Batch defaults: {progress.defaults.finish.toLowerCase()} · {progress.defaults.condition ?? "condition unset"} · Change</summary>
          <AcquisitionBatchDefaults
            key={`defaults:${batchId}`}
            batchId={batchId}
            defaults={progress.defaults}
            revision={progress.defaultsRevision}
            refresh={() => void refresh()}
          />
          </details>
          <AcquisitionBulkReview key={`bulk:${batchId}`} batchId={batchId} slots={progress.slots} defaults={progress.defaults} refresh={refresh}
            blockedPhotos={blockedPhotos} draftsReady={cachedDrafts.ready} canUsePhotos={canUsePhotos}
            onOpenChange={setBulkOpen} onConfirmed={ids => { setSelectedPhotos(previous => [...new Set([...previous, ...ids])]); showInventory(); }}
            onInspect={position => { setReviewFilter("all"); setVisibleCount(count => Math.max(count, position));
              requestAnimationFrame(() => document.getElementById(`capture-card-${position}`)?.scrollIntoView({ block: "start" })); }} />
          <div id="scan-inventory" className="scroll-mt-56" hidden={!inventoryOpen}>
            <button className={button + " mb-2"} onClick={() => { setInventoryOpen(false); document.getElementById("scan-review")?.scrollIntoView({ block: "start" }); }}>Back to matches</button>
            <AcquisitionCommitControls key={`commit:${batchId}`} progress={progress} locations={locations}
              blockedPhotos={blockedPhotos} draftsReady={cachedDrafts.ready} canUsePhotos={canUsePhotos}
              selected={selectedPhotos} onSelect={setSelectedPhotos} refresh={refresh} />
          </div>
          <div className="flex flex-col gap-4">
            <section
              id="scan-review"
              hidden={bulkOpen}
              className={panel + " scroll-mt-56"}
            >
              <h3 className="font-semibold">Saved cards</h3>
              <div className="flex flex-wrap items-end justify-between gap-3 my-3">
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label="Review mode"
                >
                  {(["simple", "advanced"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={reviewMode === mode ? primary : button}
                      aria-pressed={reviewMode === mode}
                      onClick={() => {
                        setReviewMode(mode);
                        try {
                          localStorage.setItem(
                            `mtg-acquisition-review-mode:${userId}`,
                            mode,
                          );
                        } catch {
                          /* Mode switching does not require storage. */
                        }
                      }}
                    >
                      {mode === "simple" ? "Simple" : "Advanced"}
                    </button>
                  ))}
                </div>
                <label className="text-sm">
                  Show cards
                  <select
                    className={input + " ml-2"}
                    value={reviewFilter}
                    onChange={(e) => {
                      setReviewFilter(e.target.value as AcquisitionReviewFilter);
                      // Manual filtering starts a page; target navigation above
                      // keeps the larger extent it needs to reach its card.
                      setVisibleCount(12);
                    }}
                  >
                    <option value="all">All ({reviewCounts.all})</option>
                    <option value="awaiting">
                      Awaiting review ({reviewCounts.awaiting})
                    </option>
                    <option value="ready">
                      Ready for Inventory ({reviewCounts.ready})
                    </option>
                    <option value="added">
                      Added to Inventory ({reviewCounts.added})
                    </option>
                  </select>
                </label>
              </div>
              {reviewMode === "simple" && (
                <a className="text-sm underline" href="#scan-inventory" onClick={event => { event.preventDefault(); showInventory(); }}>
                  Go to Inventory confirmation
                </a>
              )}
              <p className="text-sm mb-3" data-testid="scan-review-summary">
                {reviewCounts.awaiting} awaiting review · {reviewCounts.ready}{" "}
                ready for Inventory · {reviewCounts.added} added.
                {reviewMode === "simple"
                  ? " Compare the images, confirm or correct. Advanced shows recognition evidence."
                  : " Full recognition evidence and correction tools are shown."}{" "}
                Confirming a match saves your review; adding copies to Inventory
                is a separate step.
              </p>
              {!!dirtyPhotos.size && (
                <p className="text-sm mb-3" role="status">
                  Unsaved edits stay visible when you change the filter.
                </p>
              )}
              {reviewNavigation && <p role="status" className="text-sm mb-3">{reviewNavigation}</p>}
              <div
                className={reviewMode === "simple" ? "space-y-3" : "space-y-6"}
              >
                {shownSlots.map((slot) => {
                  const photo = slot.photos.find((p) => p.ready),
                    pending = uploads.some((p) => p.slotId === slot.id);
                  const preparation = progress.photoPreparation.find(
                    (p) => p.photoId === photo?.id,
                  )?.status;
                  return (
                    <div
                      key={slot.id}
                      id={`capture-card-${slot.position + 1}`}
                      data-testid={`capture-card-${slot.position + 1}`}
                      tabIndex={-1}
                      className={`min-w-0 scroll-mt-64 lg:scroll-mt-48 space-y-2 border-b border-[var(--app-border)] ${reviewMode === "simple" ? "pb-3" : "pb-6"}`}
                    >
                      <p>
                        Card {slot.position + 1}
                        {photo?.inputKind === "CARD_SCAN" ? " · Card scan" : ""}
                      </p>
                      {photo && !photo.purgedAt ? (
                        <AcquisitionPhotoReview
                          userId={userId}
                          key={photo.id}
                          batchId={batchId}
                          photoId={photo.id}
                          committed={slot.committed}
                          refreshKey={`${progress.defaultsRevision}:${JSON.stringify(slot.review)}:${preparation}`}
                          refresh={() => void refresh()}
                          mode={reviewMode}
                          onDirtyChange={markPhotoDirty}
                          onNextAwaiting={() => nextAwaitingReview(slot.position)}
                        />
                      ) : (
                        <p className="text-sm">
                          {photo?.purgedAt
                            ? "Photo retention ended"
                            : "Awaiting photo"}
                        </p>
                      )}
                      {slot.review && reviewMode === "advanced" && (
                        <p className="text-sm break-words">
                          {slot.review.cardName ?? "Selected printing"} ·{" "}
                          {slot.review.setCode?.toUpperCase()} #
                          {slot.review.collectorNumber} {" · "}
                          {slot.review.finish.toLowerCase()} ·{" "}
                          {slot.review.condition}
                        </p>
                      )}
                      {slot.committed && reviewMode === "advanced" && (
                        <p className="text-sm font-semibold">
                          Added to Inventory
                        </p>
                      )}
                      {photo && slot.review && !slot.committed && (
                        <label className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={`Select card ${slot.position + 1} for Inventory`}
                            checked={selectedPhotos.includes(photo.id)}
                            disabled={!cachedDrafts.ready || blockedPhotos.has(photo.id)}
                            onChange={(e) =>
                              setSelectedPhotos((ids) =>
                                e.target.checked
                                  ? [...new Set([...ids, photo.id])]
                                  : ids.filter((id) => id !== photo.id),
                              )
                            }
                          />
                          {blockedPhotos.has(photo.id) ? "Save or cancel this correction before adding" : "Add this copy"}
                        </label>
                      )}
                      {progress.providerId !== SCANNER_CAPTURE_PROVIDER && <button
                        className={
                          button +
                          (reviewMode === "advanced" ? " w-full" : " text-xs")
                        }
                        disabled={
                          busy ||
                          pending ||
                          slot.committed ||
                          !["CAPTURING", "STOPPING"].includes(progress.phase)
                        }
                        onClick={() => {
                          if (camera && cameraReady) void capture(slot);
                          else {
                            replacement.current = slot;
                            fileInput.current?.click();
                          }
                        }}
                      >
                        {photo ? "Retake" : "Add photo"}
                      </button>}
                    </div>
                  );
                })}
              </div>
              {!shownSlots.length && (
                <p className="text-sm">
                  No cards in this view. Choose All to return to the batch.
                </p>
              )}
              {visibleCount < filteredSlots.length && (
                <div ref={moreCards} className="mt-3">
                  <button
                    className={button}
                    onClick={() => setVisibleCount((n) => n + 12)}
                  >
                    Load more cards
                  </button>
                </div>
              )}
              <p className="text-xs mt-3">
                Showing {Math.min(visibleCount, filteredSlots.length)} of{" "}
                {filteredSlots.length} matching cards.
                {shownSlots.length > visibleIds.size
                  ? ` ${shownSlots.length - visibleIds.size} other cards with unsaved edits stay visible.`
                  : ""}{" "}
                More cards load as you scroll.
              </p>
            </section>
          </div>
        </>
      )}
      <p className="text-xs text-[var(--app-muted)]">
        Original photos stay private. After cards are committed, photos are kept
        for 7 days. Unfinished batches stay until you finish or discard them.
      </p>
    </div>
  );
}
