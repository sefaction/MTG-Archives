"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterFieldClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";

type ExportOwner = {
  id: string;
  name: string;
  locations: Array<{ id: string; name: string }>;
};

export function InventoryExportForm({
  owners,
  initialOwnerId,
  initialLocationId,
  adminMode,
}: {
  owners: ExportOwner[];
  initialOwnerId: string;
  initialLocationId?: string;
  adminMode: boolean;
}) {
  const initialOwner =
    owners.find((owner) => owner.id === initialOwnerId) ?? owners[0];
  const initialLocation = initialOwner?.locations.find(
    (location) => location.id === initialLocationId,
  );
  const [ownerId, setOwnerId] = useState(initialOwner?.id ?? "");
  const [scope, setScope] = useState<"owner" | "location">(
    initialLocation ? "location" : "owner",
  );
  const [locationId, setLocationId] = useState(initialLocation?.id ?? "");
  const selectedOwner = useMemo(
    () => owners.find((owner) => owner.id === ownerId) ?? owners[0],
    [ownerId, owners],
  );
  const locations = selectedOwner?.locations ?? [];
  const needsLocation = scope === "location";

  return (
    <form
      action="/api/inventory/export"
      method="get"
      className="grid grid-cols-2 gap-3 md:grid-cols-4 md:items-end"
    >
      <label className={filterFieldClass}>
        Export
        <select
          name="scope"
          value={scope}
          className={cn(filterSelectClass, "mt-1 w-full")}
          onChange={(event) => {
            const nextScope = event.target.value as "owner" | "location";
            setScope(nextScope);
            if (nextScope === "location" && !locationId) {
              setLocationId(locations[0]?.id ?? "");
            }
          }}
        >
          <option value="owner">Whole collection</option>
          <option value="location">Specific location</option>
        </select>
      </label>

      {adminMode ? (
        <label className={filterFieldClass}>
          Current owner
          <select
            name="ownerId"
            value={ownerId}
            className={cn(filterSelectClass, "mt-1 w-full")}
            onChange={(event) => {
              const nextOwnerId = event.target.value;
              const nextOwner = owners.find(
                (owner) => owner.id === nextOwnerId,
              );
              setOwnerId(nextOwnerId);
              setLocationId(nextOwner?.locations[0]?.id ?? "");
            }}
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="ownerId" value={ownerId} />
      )}

      <label className={filterFieldClass}>
        Location
        <select
          name="locationId"
          value={needsLocation ? locationId : ""}
          required={needsLocation}
          disabled={!needsLocation}
          className={cn(filterSelectClass, "mt-1 w-full")}
          onChange={(event) => setLocationId(event.target.value)}
        >
          <option value="">
            {locations.length ? "Choose a location" : "No locations available"}
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <label className={filterFieldClass}>
        Format
        <select name="format" className={cn(filterSelectClass, "mt-1 w-full")}>
          <option value="full">MTG Archives full CSV</option>
          <option value="moxfield">Moxfield collection CSV</option>
        </select>
      </label>

      <div className="col-span-2 md:col-span-4">
        <SubmitButton
          pendingLabel="Generating…"
          className={filterPrimaryButtonClass}
          disabled={needsLocation && !locationId}
        >
          Download CSV
        </SubmitButton>
      </div>

      <p className="col-span-2 text-xs text-zinc-400 md:col-span-4">
        Exports never move inventory. Deck-managed locations are excluded here;
        deck exports belong on their deck pages.
      </p>
    </form>
  );
}
