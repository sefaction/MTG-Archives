"use client";
import { useState } from "react";
import { filterButtonClass, filterInputClass } from "./filterStyles";
export function BulkBoxCreate({
  onCreated,
}: {
  onCreated: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(""),
    [capacity, setCapacity] = useState(1000),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details>
      <summary className={filterButtonClass}>Create Bulk Box</summary>
      <div className="my-2 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Box name
          <input
            value={name}
            maxLength={120}
            placeholder="Bulk-0001"
            className={`${filterInputClass} mt-1 block`}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Card capacity
          <input
            type="number"
            min={1}
            max={1000000}
            value={capacity}
            className={`${filterInputClass} mt-1 block w-28`}
            onChange={(event) => setCapacity(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className={filterButtonClass}
          disabled={
            busy ||
            !name.trim() ||
            !Number.isSafeInteger(capacity) ||
            capacity < 1
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const response = await fetch("/api/bulk-boxes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "CREATE", name, capacity }),
              });
              const value = await response.json();
              if (!response.ok)
                throw Error(value.error || "Could not create bulk box.");
              setName("");
              await onCreated(value.id);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not create bulk box.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create box"}
        </button>
        <p className="w-full text-xs text-[var(--app-muted)]">
          Creates independent bulk storage with its own capacity. No vault slots
          are used. Existing boxes can be marked bulk on Locations.
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
