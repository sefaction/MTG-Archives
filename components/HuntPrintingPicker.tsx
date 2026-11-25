"use client";
import { useEffect, useRef, useState } from "react";
import type { CardHuntInput, buildCardHunt } from "@/lib/card-hunt-service";
import { filterButtonClass, filterInputClass } from "./filterStyles";
type Option = NonNullable<
  Awaited<ReturnType<typeof buildCardHunt>>["lines"][number]["printingOptions"]
>[number];
export function HuntPrintingPicker({
  input,
  requestId,
  name,
  onChoose,
  onClose,
}: {
  input: CardHuntInput;
  requestId: string;
  name: string;
  onChoose: (option: Option | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [options, setOptions] = useState<Option[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const controller = new AbortController();
    void fetch("/api/card-hunt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, printingRequestId: requestId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Could not read available printings.");
        if (!controller.signal.aborted) {
          setOptions(
            result.lines.find(
              (row: { request: { id: string } }) =>
                row.request.id === requestId,
            )?.printingOptions ?? [],
          );
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read printings.",
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      node.close();
    };
  }, [input, requestId]);
  return (
    <dialog
      ref={dialog}
      aria-label={`Owned printings of ${name}`}
      onCancel={onClose}
      className="m-auto max-h-[90dvh] w-[min(50rem,94vw)] overflow-auto rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-[var(--app-text)] backdrop:bg-black/70"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Select another printing: {name}
        </h2>
        <button type="button" className={filterButtonClass} onClick={onClose}>
          Close
        </button>
      </div>
      <p className="my-3 text-sm text-[var(--app-muted)]">
        Your available storage only. Quantities are shared across this hunt.
        Pulled copies stay fixed; the remaining request uses your choice.
      </p>
      <label className="block text-sm">
        Find a set or finish
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${filterInputClass} my-2 w-full`}
        />
      </label>
      {loading && <p role="status">Checking owned printings…</p>}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className={filterButtonClass}
        onClick={() => onChoose(null)}
      >
        Use hunt preferences instead
      </button>
      <ul className="divide-y divide-[var(--app-border)]">
        {options
          .filter((option) =>
            `${option.setCode} ${option.collectorNumber} ${option.finish}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((option) => (
            <li
              key={`${option.cardId}:${option.finish}`}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              {option.card?.imageUri && (
                <img
                  src={option.card.imageUri}
                  alt={`${name} ${option.setCode} ${option.collectorNumber}`}
                  width={63}
                  height={88}
                  className="h-24 w-auto rounded"
                />
              )}
              <span className="flex-1 text-sm">
                {option.setCode.toUpperCase()} #{option.collectorNumber} ·{" "}
                {option.finish}
                <br />
                {option.available} available
              </span>
              <button
                type="button"
                className={filterButtonClass}
                onClick={() => onChoose(option)}
              >
                Use this printing
              </button>
            </li>
          ))}
      </ul>
      {!loading && !options.length && (
        <p>No available owned printings in the current location scope.</p>
      )}
    </dialog>
  );
}
