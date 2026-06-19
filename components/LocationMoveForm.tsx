"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterFieldClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";

export type LocationMoveOption = {
  id: string;
  name: string;
  entries: number;
  quantity: number;
  effectiveVisibility: "PRIVATE" | "PUBLIC";
};

type Props = {
  locations: LocationMoveOption[];
  moveAction: (formData: FormData) => Promise<void>;
};

function visibilityText(value?: "PRIVATE" | "PUBLIC") {
  return value === "PUBLIC" ? "Public" : "Private";
}

export function LocationMoveForm({ locations, moveAction }: Props) {
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const source = useMemo(
    () => locations.find((location) => location.id === sourceId),
    [locations, sourceId],
  );
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
    <form action={moveAction} className="grid gap-3 md:grid-cols-4">
      <label className={filterFieldClass}>
        Source location
        <select
          name="sourceLocationId"
          required
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          className={cn(filterSelectClass, "mt-1 w-full")}
        >
          <option value="">Choose source</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name} — {location.quantity} cards / {location.entries}{" "}
              entries — {visibilityText(location.effectiveVisibility)}
            </option>
          ))}
        </select>
      </label>
      <label className={filterFieldClass}>
        Destination location
        <select
          name="destinationLocationId"
          required
          value={destinationId}
          onChange={(event) => setDestinationId(event.target.value)}
          className={cn(filterSelectClass, "mt-1 w-full")}
        >
          <option value="">Choose destination</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name} — {visibilityText(location.effectiveVisibility)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
        <input type="checkbox" name="confirmMove" />
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
        >
          Move entire location
        </SubmitButton>
      </div>
    </form>
  );
}
