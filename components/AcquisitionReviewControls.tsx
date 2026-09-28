"use client";
import { useEffect, useRef, useState } from "react";
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
import type {
  AcquisitionCardReview,
  AcquisitionDefaults,
  AcquisitionPrinting,
} from "@/lib/acquisition-review";

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
        Strong printing matches confirm automatically using these defaults. You
        can correct any card. Already confirmed cards keep their saved values.
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
}: {
  batchId: string;
  photoId: string;
  refresh: () => void;
  refreshKey: string;
  committed?: boolean;
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
  const dirty = useRef(false),
    requestVersion = useRef(0);
  function apply(next: AcquisitionCardReview) {
    setRecord(next);
    const choice = next.printing ?? next.suggestions[0]?.printing ?? null;
    setSelected(choice);
    setFinish(next.review?.finish ?? next.defaults.finish);
    setCondition(next.review?.condition ?? next.defaults.condition ?? "");
    setLanguage(next.review?.language ?? choice?.lang ?? "");
    setError("");
    dirty.current = false;
  }
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { rootMargin: "500px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const recognitionStatus = record?.recognitionStatus;
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
                  }
                : previous,
            );
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (
        !recognitionStatus ||
        ["WAITING", "RUNNING", "PENDING"].includes(recognitionStatus)
      )
        void load();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // A dirty form retains its revision so a concurrent edit is rejected on save.
  }, [active, endpoint, photoId, refreshKey, busy, recognitionStatus]);
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
  async function submit(action: "accept" | "pending") {
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
      setMessage(
        action === "accept"
          ? "Review saved. Not yet added to Inventory."
          : "Kept pending.",
      );
      refresh();
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
  return (
    <div
      ref={root}
      className="min-w-0"
      style={{ minHeight: record ? undefined : 560 }}
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
                    : record.recognitionStatus === "WAITING"
                      ? "Waiting for identification · manual selection available"
                      : "Needs review"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-6 min-w-0">
            <AcquisitionScanImage
              src={`/api/acquisition/${batchId}/photos/${photoId}`}
              evidence={record.evidence}
              active={active}
              position={record.position + 1}
            />
            <figure className="min-w-0">
              <figcaption className="font-semibold mb-2 min-h-12 sm:min-h-0">
                {record.review ? "Selected printing" : "Proposed printing"}
              </figcaption>
              <div className="aspect-[1000/1397] max-h-[52vh] flex items-center justify-center bg-black/10 rounded overflow-hidden">
                {selected?.imageUri && active ? (
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
                )}
              </div>
              <p className="font-semibold text-sm mt-2 break-words">
                {selected?.name ?? "Choose a printing below"}
              </p>
              {selected && (
                <p className="text-sm break-words">
                  {selected.setCode.toUpperCase()} #{selected.collectorNumber} ·{" "}
                  {selected.lang?.toUpperCase() ?? "Language unknown"}
                </p>
              )}
              <p className="text-xs mt-1">
                {record.review
                  ? "Your saved choice may differ from the scanner's evidence."
                  : "Suggested from text; artwork has not been compared."}
              </p>
            </figure>
          </div>
          {!committed && (
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
                        dirty.current = true;
                        setSelected(card);
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
              <details className="mt-3" open={!options.length}>
                <summary className="cursor-pointer font-semibold">
                  Find another printing
                </summary>
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
                      className={input + " block w-full"}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      Set code
                      <input
                        className={input + " block w-full"}
                        value={set}
                        onChange={(e) => setSet(e.target.value)}
                      />
                    </label>
                    <label>
                      Collector number
                      <input
                        className={input + " block w-full"}
                        value={number}
                        onChange={(e) => setNumber(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className={button}>Find printing</button>
                  <p className="text-xs">
                    Search currently uses this installation’s catalog. External
                    lookup is not yet available.
                  </p>
                  {matches?.length === 50 && (
                    <p className="text-xs">
                      Showing 50 results. Add set and collector number to narrow
                      the search.
                    </p>
                  )}
                </form>
              </details>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label>
                  Card finish
                  <select
                    className={input + " block w-full"}
                    value={finish}
                    onChange={(e) => {
                      dirty.current = true;
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
                      dirty.current = true;
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
                      dirty.current = true;
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
                <button
                  className={button}
                  onClick={() => void submit("pending")}
                >
                  Keep pending
                </button>
              </div>
            </fieldset>
          )}
          {message && (
            <p role="status" className="text-sm mt-2">
              {message}
            </p>
          )}
          <AcquisitionEvidenceFields
            evidence={record.evidence}
            selected={selected}
            reasons={reasons}
            status={record.recognitionStatus}
          />
        </>
      )}
    </div>
  );
}
