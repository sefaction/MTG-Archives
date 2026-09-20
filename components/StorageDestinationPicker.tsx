"use client";

import { useId, useState } from "react";
import {
  isVault,
  spaceLabel,
  projectedSectionQuantity,
  type StorageLocation,
} from "@/lib/storage-sections";
import { cn, filterInputClass, filterSelectClass } from "./filterStyles";

export function StorageDestinationPicker({
  locations,
  locationId,
  onLocationChange,
  section,
  onSectionChange,
  incomingQuantity,
  alreadyThere = 0,
  locationField = "destinationLocationId",
  sectionField = "destinationLocationSection",
  disabled = false,
}: {
  locations: StorageLocation[];
  locationId: string;
  onLocationChange: (id: string) => void;
  section: string;
  onSectionChange: (section: string) => void;
  incomingQuantity?: number;
  alreadyThere?: number;
  locationField?: string;
  sectionField?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [onlyWithRoom, setOnlyWithRoom] = useState(false);
  const listId = useId();
  const destination = locations.find((l) => l.id === locationId);
  const selectedSection = destination?.sections.find(
    (s) => s.name === section.trim(),
  );
  const projected =
    selectedSection && incomingQuantity !== undefined
      ? projectedSectionQuantity(
          selectedSection.quantity,
          incomingQuantity,
          alreadyThere,
        )
      : undefined;
  return (
    <div className="min-w-0 space-y-2" data-testid="storage-destination">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Find destination
          <input
            aria-label="Find destination"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Search storage paths"
            disabled={disabled}
          />
        </label>
        <label className="text-sm">
          Move to location
          <select
            aria-label="Destination location"
            name={locationField}
            value={locationId}
            onChange={(e) => {
              onLocationChange(e.target.value);
              onSectionChange("");
            }}
            required
            disabled={disabled}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">Choose destination</option>
            {locations
              .filter(
                (l) =>
                  l.id === locationId ||
                  l.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Section within location (optional)
          <input
            name={sectionField}
            aria-label="Section within location"
            value={section}
            onChange={(e) => onSectionChange(e.target.value)}
            list={listId}
            maxLength={100}
            disabled={disabled}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Choose below or type a section"
          />
        </label>
      </div>
      <datalist id={listId}>
        {destination?.sections
          .filter((s) => s.name)
          .map((s) => (
            <option key={s.name} value={s.name}>
              {spaceLabel(s)}
            </option>
          ))}
      </datalist>
      {destination && (
        <>
          {isVault(destination.type) && (
            <p className="text-xs text-zinc-400">
              Vault: six sections, 85 cards each. Capacity is advisory.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={onlyWithRoom}
              onChange={(e) => setOnlyWithRoom(e.target.checked)}
            />
            Only sections with room
          </label>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {destination.sections
              .filter(
                (s) =>
                  !onlyWithRoom ||
                  (s.capacity !== null && s.quantity < s.capacity),
              )
              .map((s) => (
                <button
                  key={s.name}
                  type="button"
                  aria-pressed={section === s.name}
                  disabled={disabled}
                  onClick={() => onSectionChange(s.name)}
                  className={cn(
                    "rounded border p-2 text-left text-xs",
                    section === s.name
                      ? "border-sky-500 bg-sky-950/40"
                      : "border-zinc-700",
                    s.capacity !== null &&
                      s.quantity > s.capacity &&
                      "text-amber-200",
                  )}
                >
                  <span className="block font-semibold">
                    {s.name || "No section"}
                  </span>
                  {spaceLabel(s)}
                </button>
              ))}
          </div>
          {selectedSection && (
            <p role="status" className="text-sm">
              {spaceLabel(selectedSection)}
              {projected !== undefined ? ` → ${projected} after move` : ""}
            </p>
          )}
          {selectedSection?.capacity != null &&
            (projected ?? selectedSection.quantity) >
              selectedSection.capacity && (
              <p
                role="status"
                className="rounded border border-amber-700 p-2 text-sm text-amber-200"
              >
                All cards may not fit:{" "}
                {(projected ?? selectedSection.quantity) -
                  selectedSection.capacity}{" "}
                over the advisory capacity. You can still continue.
              </p>
            )}
        </>
      )}
    </div>
  );
}

export function StorageDestinationFields({
  locations,
  defaultLocationId = "",
  incomingQuantity,
  locationField,
  sectionField,
}: {
  locations: StorageLocation[];
  defaultLocationId?: string;
  incomingQuantity?: number;
  locationField?: string;
  sectionField?: string;
}) {
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [section, setSection] = useState("");
  return (
    <StorageDestinationPicker
      locations={locations}
      locationId={locationId}
      onLocationChange={setLocationId}
      section={section}
      onSectionChange={setSection}
      incomingQuantity={incomingQuantity}
      locationField={locationField}
      sectionField={sectionField}
    />
  );
}
