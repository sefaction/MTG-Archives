"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { filterButtonClass } from "./filterStyles";
export function BulkBoxToggle({
  location,
  inheritedBulk = false,
}: {
  inheritedBulk?: boolean;
  location: { id: string; name: string; isBulk: boolean; revision: number };
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (inheritedBulk)
    return (
      <p className="mt-3 text-sm text-[var(--app-muted)]">
        Bulk storage inherited from the parent box. Change the parent box to
        return this storage to the active keep limit.
      </p>
    );
  return (
    <div className="mt-3 space-y-2 text-sm">
      <button
        type="button"
        className={filterButtonClass}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/bulk-boxes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "TAG",
                locationId: location.id,
                revision: location.revision,
                isBulk: !location.isBulk,
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw Error(result.error || "Could not update this box.");
            router.refresh();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not update this box.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Saving…"
          : location.isBulk
            ? "Return box to normal storage"
            : "Mark box as bulk storage"}
      </button>
      <p className="text-[var(--app-muted)]">
        {location.isBulk
          ? "Bulk storage: cards stay owned and visible, and do not count toward the active keep limit."
          : "Bulk purpose applies to this box and its sub-locations. Cards stay in place; capacity and visibility stay the same."}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
