"use client";
import { acquisitionCatalogMessage } from "@/lib/acquisition-catalog-status";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AcquisitionScanImage,
  AcquisitionEvidenceFields,
} from "./AcquisitionScanInspection";
import {
  filterButtonClass as button,
  filterPrimaryButtonClass as primary,
  filterInputClass as input,
  filterPanelClass as panel,
} from "./filterStyles";
import {
  type AcquisitionCardReview,
  type AcquisitionDefaults,
  type AcquisitionPrinting,
} from "@/lib/acquisition-review";
import { finishForPrinting } from "@/lib/acquisition-finish";
import type { AcquisitionReviewMode } from "@/lib/acquisition-review-display";

const conditions = [
  ["NM", "Near mint"],
  ["LP", "Lightly played"],
  ["MP", "Moderately played"],
  ["HP", "Heavily played"],
  ["DMG", "Damaged"],
];
const finishes = [
  ["UNKNOWN", "Choose finish"],
  ["NONFOIL", "Nonfoil"],
  ["FOIL", "Foil"],
  ["ETCHED", "Etched foil"],
];
function PrintingImage({
  src,
  alt,
  thumbnail = false,
}: {
  src: string;
  alt: string;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === src ? (
    <p className="text-xs p-2">Printing image could not load. {alt}</p>
  ) : (
    <img
      src={src}
      alt={alt}
      width={400}
      height={559}
      loading={thumbnail ? "lazy" : "eager"}
      onError={() => setFailed(src)}
      className={
        thumbnail
          ? "w-full aspect-[1000/1397] object-contain mt-1"
          : "w-full h-full object-contain"
      }
    />
  );
}
async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Review could not be saved");
  return result;
}

export function AcquisitionBatchDefaults({
  batchId,
  defaults,
  revision,
  refresh,
}: {
  batchId: string;
  defaults: AcquisitionDefaults;
  revision: number;
  refresh: () => void;
}) {
  const [finish, setFinish] = useState(defaults.finish as string),
    [condition, setCondition] = useState(defaults.condition ?? "");
  const [loadedRevision, setLoadedRevision] = useState(revision),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const stale = loadedRevision !== revision;
  return (
    <section className={panel} aria-label="Batch review defaults">
      <h3 className="font-semibold">Batch defaults</h3>
      <p className="text-sm">
        Set finish and condition once for new cards. You can change them per
        card; already confirmed cards keep their saved values.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const saved = await call<{ defaultsRevision: number }>(
              `/api/acquisition/${batchId}/review`,
              {
                action: "defaults",
                revision: loadedRevision,
                defaults: { finish, condition: condition || null },
              },
            );
            setLoadedRevision(saved.defaultsRevision);
            setMessage("Batch defaults saved.");
            refresh();
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Batch finish
          <select
            className={input + " block"}
            value={finish}
            onChange={(e) => setFinish(e.target.value)}
          >
            {finishes.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          Batch condition
          <select
            className={input + " block"}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            <option value="">Choose condition</option>
            {conditions.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <button className={button} disabled={busy || stale}>
          Save batch defaults
        </button>
        {stale && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setFinish(defaults.finish);
              setCondition(defaults.condition ?? "");
              setLoadedRevision(revision);
              setMessage("");
            }}
          >
            Reload changed defaults
          </button>
        )}
      </form>
      {stale && (
        <p role="status">
          Defaults changed. Reload them before saving your changes.
        </p>
      )}
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </section>
  );
}

export function AcquisitionPhotoReview({
  batchId,
  photoId,
  refresh,
  refreshKey,
  committed = false,
  mode = "advanced",
  onDirtyChange,
  onNextAwaiting,
}: {
  batchId: string;
  photoId: string;
  refresh: () => void;
  refreshKey: string;
  committed?: boolean;
  mode?: AcquisitionReviewMode;
  onDirtyChange?: (photoId: string, dirty: boolean) => void;
  onNextAwaiting?: () => void;
}) {
  const endpoint = `/api/acquisition/${batchId}/review`;
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [record, setRecord] = useState<AcquisitionCardReview | null>(null);
  const [selected, setSelected] = useState<AcquisitionPrinting | null>(null);
  const [finish, setFinish] = useState("UNKNOWN"),
    [condition, setCondition] = useState(""),
    [language, setLanguage] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [set, setSet] = useState(""),
    [number, setNumber] = useState("");
  const [matches, setMatches] = useState<AcquisitionPrinting[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const dirty = useRef(false),
    requestVersion = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  function openCorrection() {
    focusSearch.current = true;
    setEditing(true);
    if (!query) setQuery(selected?.name ?? "");
  }
  useEffect(() => {
    if (editing && focusSearch.current) {
      focusSearch.current = false;
      searchInput.current?.focus(); searchInput.current?.select();
    }
  }, [editing]);
  function markDirty() {
    dirty.current = true;
    setDraftDirty(true);
    onDirtyChange?.(photoId, true);
  }
  const apply = useCallback(
    (next: AcquisitionCardReview) => {
      setRecord(next);
      const choice = next.printing ?? next.suggestions[0]?.printing ?? null;
      setSelected(choice);
    setFinish(next.review?.finish ?? finishForPrinting(next.defaults.finish, choice) ?? next.defaults.finish);
      setCondition(next.review?.condition ?? next.defaults.condition ?? "");
      setLanguage(next.review?.language ?? choice?.lang ?? "");
      setError("");
      dirty.current = false;
      setDraftDirty(false);
      onDirtyChange?.(photoId, false);
    },
    [onDirtyChange, photoId],
  );
  useEffect(
    () => () => onDirtyChange?.(photoId, false),
    [onDirtyChange, photoId],
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { rootMargin: "500px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const recognitionStatus = record?.recognitionStatus;
  const catalogStatus = record?.catalog?.status;
  const visualStatus = record?.visualStatus;
  const printingStatus = record?.printingStatus;
  const reviewed = Boolean(record?.review);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function load() {
      if (busy) return;
      const version = ++requestVersion.current;
      try {
        const next = await call<AcquisitionCardReview>(
          `${endpoint}?photoId=${photoId}`,
        );
        if (!cancelled && version === requestVersion.current) {
          if (!dirty.current) apply(next);
          else
            setRecord((previous) =>
              previous
                ? {
                    ...previous,
                    evidence: next.evidence,
                    suggestions: next.suggestions,
                    recognitionStatus: next.recognitionStatus,
                    catalog: next.catalog,
                    visualStatus: next.visualStatus,
                    printingStatus: next.printingStatus,
                  }
                : previous,
            );
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(
      () => {
        if (
          !reviewed &&
          (!recognitionStatus ||
            ["WAITING", "RUNNING", "PENDING"].includes(visualStatus ?? "") ||
            ["WAITING", "RUNNING", "PENDING"].includes(printingStatus ?? "") ||
            ["WAITING", "RUNNING", "PENDING"].includes(recognitionStatus) ||
            ["CHECKING", "PROVIDER_ERROR", "NOT_FOUND", "INCOMPLETE"].includes(
              catalogStatus ?? "",
            ))
        )
          void load();
      },
      catalogStatus === "PROVIDER_ERROR" ||
        catalogStatus === "NOT_FOUND" ||
        catalogStatus === "INCOMPLETE"
        ? 30000
        : 4000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // A dirty form retains its revision so a concurrent edit is rejected on save.
  }, [
    active,
    endpoint,
    photoId,
    refreshKey,
    busy,
    recognitionStatus,
    catalogStatus,
    visualStatus,
    printingStatus,
    reviewed,
    apply,
  ]);
  async function reload() {
    ++requestVersion.current;
    try {
      apply(
        await call<AcquisitionCardReview>(`${endpoint}?photoId=${photoId}`),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(action: "accept" | "pending", next = false) {
    if (!record) return;
    ++requestVersion.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await call(endpoint, {
        action,
        photoId,
        revision: record.revision,
        ...(action === "accept"
          ? {
              decision: {
                cardId: selected!.id,
                finish,
                condition,
                language: selected!.lang ?? language,
              },
            }
          : {}),
      });
      await reload();
      setEditing(false);
      setMessage(
        action === "accept"
          ? "Review saved. Not yet added to Inventory."
          : "Kept pending.",
      );
      refresh();
      if (next) onNextAwaiting?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const supported =
    !Array.isArray(selected?.finishes) ||
    !selected.finishes.length ||
    selected.finishes.includes(finish.toLowerCase());
  const options = matches ?? record?.suggestions.map((s) => s.printing) ?? [];
  const reasons =
    record?.suggestions.find((s) => s.printing.id === selected?.id)?.reasons ??
    [];
  const simple = mode === "simple";
  const showEditor = !simple || editing || draftDirty;
  const canConfirm = Boolean(
    selected &&
    finish !== "UNKNOWN" &&
    condition &&
    supported &&
    (selected.lang ?? language),
  );
  const stamp = record?.evidence?.printing;
  const stampChoice = stamp?.candidates.find((c) => c.cardId === selected?.id);
  const proposedImage =
    selected?.imageUri && active ? (
      <PrintingImage
        src={selected.imageUri}
        alt={`Printing: ${selected.name} ${selected.setCode.toUpperCase()} ${selected.collectorNumber}`}
      />
    ) : (
      <p className="p-2 text-sm">
        {selected
          ? "Printing image unavailable or outside view"
          : "No proposed printing yet"}
      </p>
    );
  return (
    <div
      ref={root}
      className="min-w-0"
      style={{ minHeight: record ? undefined : simple ? 200 : 560 }}
      onKeyDown={event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && showEditor && !committed) {
          event.preventDefault();
          if (!busy && canConfirm) void submit("accept", event.shiftKey);
        }
      }}
    >
      {error && (
        <div role="alert" className="mb-2">
          <p>{error}</p>
          <button className={button} onClick={() => void reload()}>
            Reload review
          </button>
        </div>
      )}
      {!record ? (
        <p role="status">
          {active ? "Loading card review…" : "Card review loads as you scroll."}
        </p>
      ) : (
        <>
          <p
            className="text-sm font-semibold mb-3"
            data-testid="scan-review-status"
          >
            {committed
              ? "Added to Inventory"
              : record.review?.source === "AUTO_STRONG_MATCH"
                ? "Automatically confirmed · correct below if needed"
                : record.review
                  ? "Reviewed · editable until Inventory commit"
                  : record.recognitionStatus === "STRONG_MATCH"
                    ? "Strong match · check batch defaults"
                    : !record.suggestions.length &&
                        (record.recognitionStatus === "RUNNING" ||
                          record.visualStatus === "RUNNING")
                      ? "Identifying this card · results appear here automatically"
                      : !record.suggestions.length &&
                          ["WAITING", "PENDING"].includes(
                            record.recognitionStatus,
                          )
                        ? "Queued for identification · results appear here automatically"
                        : "Needs review"}
          </p>
          {!simple && !record.review && record.visualStatus === "FAILED" && (
            <p className="text-sm mt-2" role="status">
              Image comparison failed. Your photo and text suggestions are
              saved; choose a printing manually or try another photo.
            </p>
          )}
          {!simple &&
            !record.review &&
            record.visualStatus &&
            ["WAITING", "PENDING", "RUNNING"].includes(record.visualStatus) && (
              <p
                className="text-sm mt-2"
                role="status"
                data-testid="scan-image-status"
              >
                {record.visualStatus === "RUNNING"
                  ? "Comparing this card image with catalog printings."
                  : "Image comparison queued. Text suggestions can be reviewed as they arrive."}
              </p>
            )}
          {!simple &&
            !record.review &&
            record.printingStatus &&
            record.printingStatus !== "WAITING" && (
              <p
                className="text-sm mt-2"
                role="status"
                data-testid="scan-printing-status"
              >
                {record.printingStatus === "FAILED"
                  ? "Printing verification failed. Your photo and suggestions are saved; choose a printing manually."
                  : record.printingStatus === "PENDING"
                    ? "Printing and stamp verification queued; you can review suggestions now."
                    : record.printingStatus === "RUNNING"
                      ? "Checking this printing and its lower-left stamp; you can review suggestions now."
                      : record.printingStatus === "COMPLETE"
                        ? "Printing check complete. Unreadable details still need your review."
                        : "Waiting for current printing evidence."}
              </p>
            )}
          {!simple &&
            !record.review &&
            acquisitionCatalogMessage(record.catalog) && (
              <p
                className="text-sm mb-3"
                role="status"
                data-testid="scan-catalog-status"
              >
                {acquisitionCatalogMessage(record.catalog)}
              </p>
            )}
          <div
            className={
              simple
                ? "grid grid-cols-2 lg:grid-cols-[minmax(0,260px)_minmax(0,260px)_minmax(0,1fr)] gap-3 min-w-0"
                : "grid grid-cols-2 gap-3 sm:gap-6 min-w-0"
            }
          >
            <AcquisitionScanImage
              src={`/api/acquisition/${batchId}/photos/${photoId}`}
              evidence={record.evidence}
              active={active}
              position={record.position + 1}
              compact={simple}
            />
            <figure className="min-w-0">
              <figcaption
                className={
                  simple
                    ? "text-xs font-medium mb-1"
                    : "font-semibold mb-2 min-h-12 sm:min-h-0"
                }
              >
                {record.review ? "Selected printing" : "Proposed printing"}
                {!record.review && reasons.includes("UNLOCALIZED_NAME_HINT") && (
                  <span className="block text-xs font-normal mt-1" data-testid="scan-name-only">
                    Name only · check printing
                  </span>
                )}
              </figcaption>
              <div
                className={`aspect-[1000/1397] flex items-center justify-center bg-black/10 rounded overflow-hidden ${simple ? "max-h-[60vh]" : "max-h-[75vh]"}`}
              >
                {simple && !committed ? (
                  <button
                    type="button"
                    className="w-full h-full"
                    disabled={busy}
                    aria-label={`Correct proposed printing for ${selected?.name ?? "this card"}`}
                    onClick={openCorrection}
                  >
                    {proposedImage}
                  </button>
                ) : (
                  proposedImage
                )}
              </div>
              {!simple && (
                <>
                  <p className="font-semibold text-sm mt-2 break-words">
                    {selected?.name ?? "Choose a printing below"}
                  </p>
                  {selected && (
                    <p className="text-sm break-words">
                      {selected.setCode.toUpperCase()} #
                      {selected.collectorNumber} ·{" "}
                      {selected.lang?.toUpperCase() ?? "Language unknown"}
                    </p>
                  )}
                  <p
                    className="text-xs mt-1"
                    data-testid="scan-proposal-evidence"
                  >
                    {record.review
                      ? "Your saved choice may differ from the scanner's evidence."
                      : !selected
                        ? "Waiting for suggestions; you can search below."
                        : !reasons.length
                          ? "Selected manually; compare this printing with your scan."
                          : reasons.includes("UNLOCALIZED_NAME_HINT")
                            ? "Name suggested from whole-photo text; exact printing unverified."
                          : record.evidence?.imageMatches
                            ? reasons.includes("VISUAL_MATCH") ||
                              reasons.includes("SIFT_CANDIDATE")
                              ? "Suggested from image comparison; verify the exact printing."
                              : "Suggested from text; image comparison offered other candidates."
                            : record.visualStatus === "FAILED"
                              ? "Suggested from text; image comparison failed."
                              : record.visualStatus
                                ? "Suggested from text; image results are still being combined."
                                : "Suggested from text; artwork has not been compared."}
                  </p>
                </>
              )}
            </figure>
            {simple && (
              <div className="min-w-0 col-span-2 lg:col-span-1 self-center">
                <p className="font-semibold break-words">
                  {selected?.name ?? "No proposed printing yet"}
                </p>
                {selected && (
                  <p className="text-sm break-words">
                    {selected.setCode.toUpperCase()} #{selected.collectorNumber}{" "}
                    · {selected.lang?.toUpperCase() ?? "Language unknown"}
                  </p>
                )}
                <p
                  className="text-xs mt-1"
                  role="status"
                  data-testid="scan-compact-status"
                >
                  {record.review
                    ? "Review saved"
                    : record.printingStatus === "RUNNING"
                      ? "Checking printing…"
                      : record.printingStatus === "PENDING"
                        ? "Printing check queued"
                        : record.catalog?.status === "CHECKING"
                          ? "Checking catalog…"
                          : record.printingStatus === "FAILED"
                            ? "Printing check failed · review manually"
                            : selected
                              ? "Verify this printing"
                              : "Waiting for identification"}
                </p>
                {!record.review &&
                  (record.visualStatus === "FAILED" ||
                    ["PROVIDER_ERROR", "NOT_FOUND", "INCOMPLETE"].includes(
                      record.catalog?.status ?? "",
                    )) && (
                    <p className="text-xs mt-1" role="status">
                      {record.visualStatus === "FAILED"
                        ? "Image check failed. "
                        : ""}
                      {record.catalog?.status === "PROVIDER_ERROR"
                        ? "Catalog unavailable. "
                        : record.catalog?.status === "NOT_FOUND"
                          ? "Printing not found in the catalog. "
                          : record.catalog?.status === "INCOMPLETE"
                            ? "Catalog check incomplete. "
                            : ""}
                      Review manually; Advanced shows details.
                    </p>
                  )}
                {stamp && (
                  <p className="text-xs mt-1" data-testid="scan-compact-stamp">
                    {stamp.conflictingObservations
                      ? "Stamp observations conflict"
                      : stampChoice?.relation === "CONTRADICTS_STAMP_STATE"
                        ? "Stamp differs from this printing"
                        : stamp.observedStamp === "PRESENT"
                          ? "Stamp present"
                          : stamp.observedStamp === "ABSENT"
                            ? "Stamp absent"
                            : "Stamp unreadable"}
                    {stamp.observedStamp !== "UNREADABLE" &&
                    stampChoice?.relation === "UNRESOLVED"
                      ? " · comparison unverified"
                      : ""}
                  </p>
                )}
                <p className="text-xs mt-1">
                  {finish === "UNKNOWN"
                    ? "Choose finish"
                    : finish.toLowerCase()}{" "}
                  · {condition || "Choose condition"}
                </p>
                {!committed && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {!record.review && !showEditor && (
                      <button
                        className={primary}
                        disabled={busy || !canConfirm}
                        onClick={() => void submit("accept")}
                      >
                        Confirm match
                      </button>
                    )}
                    {!showEditor && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={openCorrection}
                      >
                        Correct
                      </button>
                    )}
                    {!showEditor && onNextAwaiting && <button className={button} disabled={busy}
                      onClick={onNextAwaiting}>Next awaiting review</button>}
                    {!canConfirm && !showEditor && (
                      <p className="text-xs">
                        Set batch defaults or choose Correct to finish this
                        review.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {!committed && showEditor && (
            <fieldset className="mt-4 min-w-0" disabled={busy}>
              <legend className="font-semibold">
                {matches ? "Search results" : "Possible printings"}
              </legend>
              <p className="text-xs mb-2">
                Select an image to compare it above. Save the review to confirm
                your choice.
              </p>
              <div
                className="flex gap-2 overflow-x-auto pb-2"
                role="group"
                aria-label="Printing images"
              >
                {options.map((card) => (
                  <label
                    key={card.id}
                    className={`shrink-0 w-28 sm:w-36 rounded border-2 p-2 cursor-pointer ${selected?.id === card.id ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]" : "border-[var(--app-border)]"}`}
                  >
                    <input
                      type="radio"
                      name={`review-printing-${photoId}`}
                      checked={selected?.id === card.id}
                      onChange={() => {
                        markDirty();
                        setSelected(card);
                        setFinish(finishForPrinting(finish as AcquisitionDefaults["finish"], card) ?? "UNKNOWN");
                        setLanguage(card.lang ?? "");
                        setMessage("");
                      }}
                      aria-label={`${card.name} · ${card.setCode.toUpperCase()} #${card.collectorNumber} (${card.lang ?? "unknown"})`}
                    />
                    {active && card.imageUri ? (
                      <PrintingImage
                        thumbnail
                        src={card.imageUri}
                        alt={`${card.name}, ${card.setCode.toUpperCase()} ${card.collectorNumber}`}
                      />
                    ) : (
                      <div className="aspect-[1000/1397] text-xs">
                        {card.name}
                      </div>
                    )}
                    <span className="block text-xs break-words mt-1">
                      {card.setCode.toUpperCase()} #{card.collectorNumber} ·{" "}
                      {card.lang?.toUpperCase()}
                      <span className="block">{card.name}</span>
                      {selected?.id === card.id && (
                        <strong className="block">Selected</strong>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {!options.length && (
                <p className="text-sm">
                  No printing found. The photo may be unreadable or this
                  installation’s catalog may be missing the printing.
                </p>
              )}
              {matches && (
                <button
                  className={button + " mt-2"}
                  onClick={() => setMatches(null)}
                >
                  Back to suggestions
                </button>
              )}
              <div className="mt-3">
                <h4 className="font-semibold">
                  Find another printing
                </h4>
                <form
                  className="mt-2 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      setMatches(
                        await call<AcquisitionPrinting[]>(
                          endpoint +
                            "?" +
                            new URLSearchParams({ query, set, number }),
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="block">
                    Card name
                    <input
                      ref={searchInput}
                      className={input + " block w-full"}
                      value={query}
                      onChange={(e) => {
                        markDirty();
                        setQuery(e.target.value);
                      }}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      Set code
                      <input
                        className={input + " block w-full"}
                        value={set}
                        onChange={(e) => {
                          markDirty();
                          setSet(e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Collector number
                      <input
                        className={input + " block w-full"}
                        value={number}
                        onChange={(e) => {
                          markDirty();
                          setNumber(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <button className={button}>Find printing</button>
                  <p className="text-xs">
                    Search this installation’s catalog. Missing matches are
                    checked against Scryfall using an exact card name or set and
                    collector number.
                  </p>
                  {matches?.length === 50 && (
                    <p className="text-xs">
                      Showing 50 results. Add set and collector number to narrow
                      the search.
                    </p>
                  )}
                </form>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label>
                  Card finish
                  <select
                    className={input + " block w-full"}
                    value={finish}
                    onChange={(e) => {
                      markDirty();
                      setFinish(e.target.value);
                    }}
                  >
                    {finishes.map(([v, text]) => (
                      <option key={v} value={v}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Card condition
                  <select
                    className={input + " block w-full"}
                    value={condition}
                    onChange={(e) => {
                      markDirty();
                      setCondition(e.target.value);
                    }}
                  >
                    <option value="">Choose condition</option>
                    {conditions.map(([v, text]) => (
                      <option key={v} value={v}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selected && !selected.lang && (
                <label>
                  Card language
                  <input
                    className={input + " block"}
                    value={language}
                    onChange={(e) => {
                      markDirty();
                      setLanguage(e.target.value);
                    }}
                  />
                </label>
              )}
              {!supported && (
                <p role="status">
                  Choose a finish available for this printing:{" "}
                  {Array.isArray(selected?.finishes)
                    ? selected.finishes.join(", ")
                    : "check printing"}
                  .
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className={primary}
                  disabled={
                    !selected ||
                    finish === "UNKNOWN" ||
                    !condition ||
                    !supported ||
                    !(selected?.lang ?? language)
                  }
                  onClick={() => void submit("accept")}
                >
                  Save card review
                </button>
                {onNextAwaiting && <button className={button} disabled={!canConfirm}
                  onClick={() => void submit("accept", true)}>Save and next</button>}
                {onNextAwaiting && <button className={button} onClick={onNextAwaiting}>Next awaiting review</button>}
                <button
                  className={button}
                  onClick={() => void submit("pending")}
                >
                  Keep pending
                </button>
                {simple && (
                  <button
                    className={button}
                    onClick={async () => {
                      await reload();
                      setEditing(false);
                    }}
                  >
                    Cancel changes
                  </button>
                )}
              </div>
              <p className="text-xs mt-2">Ctrl+Enter saves; Ctrl+Shift+Enter saves and moves to the next card awaiting review. Inventory is unchanged.</p>
            </fieldset>
          )}
          {message && (
            <p role="status" className="text-sm mt-2">
              {message}
            </p>
          )}
          {!simple && (
            <AcquisitionEvidenceFields
              evidence={record.evidence}
              selected={selected}
              reasons={reasons}
              status={record.recognitionStatus}
            />
          )}
        </>
      )}
    </div>
  );
}
