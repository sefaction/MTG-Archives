"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { LocationSearchSelect } from "@/components/LocationSearchSelect";
import { filterPrimaryButtonClass } from "@/components/filterStyles";

export type LocationMoveOption = {
  id: string;
  name: string;
  entries: number;
  quantity: number;
  effectiveVisibility: "PRIVATE" | "PUBLIC";
};

type Props = {
  locations: LocationMoveOption[];
  source: LocationMoveOption;
  moveAction: (formData: FormData) => Promise<void>;
};

function visibilityText(value?: "PRIVATE" | "PUBLIC") {
  return value === "PUBLIC" ? "Public" : "Private";
}

export function LocationMoveForm({ locations, source, moveAction }: Props) {
  const [destinationId, setDestinationId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const destination = useMemo(
    () => locations.find((location) => location.id === destinationId),
    [locations, destinationId],
  );
  const warning =
    source &&
    destination &&
    source.effectiveVisibility !== destination.effectiveVisibility
      ? destination.effectiveVisibility === "PUBLIC"
        ? `Moving these cards to ${destination.name} will make them visible on your public collection page when your public profile is enabled.`
        : `Moving these cards to ${destination.name} will remove them from your public collection page.`
      : "";

  return (
    <form action={moveAction} className="space-y-3">
      <input type="hidden" name="sourceLocationId" value={source.id} />
      <p className="break-words text-sm">
        <strong>{source.name}</strong> — {source.quantity.toLocaleString()}{" "}
        copies / {source.entries.toLocaleString()} entries —{" "}
        {visibilityText(source.effectiveVisibility)}
      </p>
      <LocationSearchSelect
        name="destinationLocationId"
        label="Destination location"
        emptyLabel="Choose destination"
        required
        locations={locations}
        value={destinationId}
        onChange={(id) => {
          setDestinationId(id);
          setConfirmed(false);
        }}
      />
      <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
        <input
          type="checkbox"
          name="confirmMove"
          required
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        Confirm moving all cards from the source location.
      </label>
      <div className="space-y-2">
        {warning ? (
          <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs text-amber-100">
            {warning}
          </p>
        ) : source && destination ? (
          <p className="rounded border border-zinc-800 p-2 text-xs text-zinc-400">
            Both locations are effectively{" "}
            {visibilityText(destination.effectiveVisibility).toLowerCase()}.
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Moving location…"
          className={filterPrimaryButtonClass}
          disabled={!destination || !confirmed || source.quantity <= 0}
        >
          Move entire location
        </SubmitButton>
      </div>
    </form>
  );
}
