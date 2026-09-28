"use client";
import { useEffect, useState } from "react";
import { DeckWorkspaceDialog } from "./DeckWorkspaceDialog";
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
  reviewed,
  automatic = false,
  refresh,
}: {
  batchId: string;
  photoId: string;
  reviewed: boolean;
  automatic?: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={button + " w-full"} onClick={() => setOpen(true)}>
        {automatic ? "Correct match" : reviewed ? "Edit review" : "Review card"}
      </button>
      {reviewed && (
        <p className="text-xs">
          {automatic ? "Automatically confirmed" : "Reviewed"} · awaiting
          Inventory commit
        </p>
      )}
      {open && (
        <ReviewDialog
          batchId={batchId}
          photoId={photoId}
          close={() => setOpen(false)}
          saved={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function ReviewDialog({
  batchId,
  photoId,
  close,
  saved,
}: {
  batchId: string;
  photoId: string;
  close: () => void;
  saved: () => void;
}) {
  const endpoint = `/api/acquisition/${batchId}/review`;
  const [record, setRecord] = useState<AcquisitionCardReview | null>(null),
    [selected, setSelected] = useState<AcquisitionPrinting | null>(null);
  const [finish, setFinish] = useState("UNKNOWN"),
    [condition, setCondition] = useState(""),
    [language, setLanguage] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [set, setSet] = useState(""),
    [number, setNumber] = useState("");
  const [matches, setMatches] = useState<AcquisitionPrinting[] | null>(null);
  function apply(next: AcquisitionCardReview) {
    setRecord(next);
    setSelected(next.printing);
    setFinish(next.review?.finish ?? next.defaults.finish);
    setCondition(next.review?.condition ?? next.defaults.condition ?? "");
    setLanguage(next.review?.language ?? next.printing?.lang ?? "");
    setError("");
  }
  useEffect(() => {
    let active = true;
    call<AcquisitionCardReview>(`${endpoint}?photoId=${photoId}`)
      .then((next) => {
        if (active) apply(next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [endpoint, photoId]);
  const supported =
    !Array.isArray(selected?.finishes) ||
    !selected.finishes.length ||
    selected.finishes.includes(finish.toLowerCase());
  async function submit(action: "accept" | "pending") {
    if (!record) return;
    setBusy(true);
    setError("");
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
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(card: AcquisitionPrinting) {
    setSelected(card);
    setLanguage(card.lang ?? "");
  }
  function printingOption(card: AcquisitionPrinting, reason?: string) {
    return (
      <label
        key={card.id}
        className="flex gap-2 rounded border border-[var(--app-border)] p-2 cursor-pointer"
      >
        <input
          type="radio"
          name="review-printing"
          checked={selected?.id === card.id}
          onChange={() => choose(card)}
        />
        <span className="min-w-0 break-words">
          {card.name} · {card.setCode.toUpperCase()} #{card.collectorNumber} (
          {card.lang ?? "language unknown"})
          {reason && <span className="block text-xs">{reason}</span>}
        </span>
      </label>
    );
  }
  return (
    <DeckWorkspaceDialog
      title={record ? `Review card ${record.position + 1}` : "Review card"}
      onClose={close}
    >
      {error && (
        <div role="alert" className="mb-3 space-y-2">
          <p>{error}</p>
          <button
            className={button}
            onClick={() =>
              void call<AcquisitionCardReview>(`${endpoint}?photoId=${photoId}`)
                .then(apply)
                .catch((e) => setError(e.message))
            }
          >
            Reload review
          </button>
        </div>
      )}
      {!record ? (
        <p role="status">Loading review…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <a
              href={`/api/acquisition/${batchId}/photos/${photoId}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
            >
              <img
                className="w-28 h-40 object-contain"
                src={`/api/acquisition/${batchId}/photos/${photoId}`}
                alt={`Original card ${record.position + 1}`}
              />
              <span className="text-xs underline">Open full photo</span>
            </a>
            <div className="min-w-0">
              <p>Choose the exact printing, then check finish and condition.</p>
              {selected && (
                <p className="mt-2 font-semibold break-words">
                  Selected: {selected.name} · {selected.setCode.toUpperCase()} #
                  {selected.collectorNumber}
                </p>
              )}
              <p className="mt-2 text-sm">
                Saving a review does not add a card to Inventory.
              </p>
            </div>
          </div>
          {record.recognitionStatus === "CONFLICT" && (
            <p role="status">
              The photo text conflicts. Check the set and collector number
              carefully.
            </p>
          )}
          <fieldset>
            <legend className="font-semibold">Suggested printings</legend>
            <div className="max-h-52 overflow-auto space-y-2 mt-2">
              {record.suggestions.map(({ printing, reasons }) =>
                printingOption(
                  printing,
                  reasons.includes("SET_AND_COLLECTOR_TEXT")
                    ? "Set and collector text matched"
                    : reasons.includes("TITLE_AND_COLLECTOR_TEXT")
                      ? "Name and collector text matched; verify set"
                      : "Name suggestion; verify printing",
                ),
              )}
            </div>
            {!record.suggestions.length && (
              <p className="text-sm">
                No suggestions available yet. You can find the printing
                manually.
              </p>
            )}
          </fieldset>
          <details open={!record.suggestions.length}>
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
              <button className={button} disabled={busy}>
                Find printing
              </button>
            </form>
            {matches && (
              <div className="mt-2 max-h-52 overflow-auto space-y-2">
                {matches.map((c) => printingOption(c))}
                {!matches.length && (
                  <p>
                    No local printings match. Try the name or correct the
                    set/number.
                  </p>
                )}
                {matches.length === 50 && (
                  <p>
                    Showing 50 results. Add a set and collector number to narrow
                    them.
                  </p>
                )}
              </div>
            )}
          </details>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label>
              Card finish
              <select
                className={input + " block w-full"}
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
              Card condition
              <select
                className={input + " block w-full"}
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
          </div>
          {!supported && (
            <p role="status">
              Choose a finish available for this printing:{" "}
              {Array.isArray(selected?.finishes)
                ? selected.finishes.join(", ")
                : "check printing"}
              .
            </p>
          )}
          {selected?.lang ? (
            <p className="text-sm">
              Printing language: {selected.lang.toUpperCase()}
            </p>
          ) : (
            selected && (
              <label>
                Card language
                <input
                  className={input + " block"}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="Language code, such as en"
                />
              </label>
            )
          )}
          <div className="sticky bottom-0 bg-[var(--app-surface)] py-3 flex flex-wrap gap-2">
            <button
              className={primary}
              disabled={
                busy ||
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
              disabled={busy}
              onClick={() => void submit("pending")}
            >
              Keep pending
            </button>
          </div>
        </div>
      )}
    </DeckWorkspaceDialog>
  );
}
