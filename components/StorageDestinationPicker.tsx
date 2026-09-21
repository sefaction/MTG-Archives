"use client";

import { useId, useRef, useState } from "react";
import {
  isVault,
  spaceLabel,
  projectedSectionQuantity,
  type StorageLocation,
} from "@/lib/storage-sections";
import { cn, filterButtonClass, filterInputClass } from "./filterStyles";

export function StorageDestinationPicker({
  locations,
  locationId,
  onLocationChange,
  section,
  onSectionChange,
  incomingQuantity,
  alreadyThere = 0,
  alreadyInLocation = 0,
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
  alreadyInLocation?: number;
  locationField?: string;
  sectionField?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState(!locationId);
  const [active, setActive] = useState(0);
  const [onlyWithRoom, setOnlyWithRoom] = useState(false);
  const [customSection, setCustomSection] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const listId = useId();
  const destination = locations.find((l) => l.id === locationId);
  const matches = locations.filter((l) =>
    (l.name + " " + (l.type ?? ""))
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const results = matches.slice(0, 30);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
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
  const sections =
    destination?.sections.filter(
      (s) =>
        s.name &&
        (!onlyWithRoom || (s.capacity !== null && s.quantity < s.capacity)),
    ) ?? [];
  function choose(location: StorageLocation) {
    onLocationChange(location.id);
    onSectionChange("");
    setChoosing(false);
    setCustomSection(false);
    setOnlyWithRoom(false);
    setSearch("");
    requestAnimationFrame(() => sectionHeadingRef.current?.focus());
  }
  return (
    <div className="min-w-0 space-y-4" data-testid="storage-destination">
      <input type="hidden" name={locationField} value={locationId} />
      <input type="hidden" name={sectionField} value={section} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">1. Destination</h3>
          {destination && choosing && (
            <button
              type="button"
              disabled={disabled}
              className="text-sm underline"
              onClick={() => setChoosing(false)}
            >
              Keep current destination
            </button>
          )}
        </div>
        {choosing || !destination ? (
          <>
            <label className="sr-only" htmlFor={listId + "-search"}>
              Search destinations
            </label>
            <input
              ref={searchRef}
              id={listId + "-search"}
              role="combobox"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                results.length ? listId + "-" + activeIndex : undefined
              }
              type="search"
              autoComplete="off"
              placeholder="Search boxes, vaults, or storage paths…"
              value={search}
              disabled={disabled}
              className={cn(filterInputClass, "w-full !py-3")}
              onChange={(event) => {
                setSearch(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      results.length - 1,
                      activeIndex + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
                  setActive(next);
                  document
                    .getElementById(listId + "-" + next)
                    ?.scrollIntoView({ block: "nearest" });
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (results[activeIndex]) choose(results[activeIndex]);
                } else if (event.key === "Escape" && destination) {
                  event.preventDefault();
                  event.stopPropagation();
                  setChoosing(false);
                }
              }}
            />
            <div
              id={listId}
              role="listbox"
              aria-label="Destination results"
              className="max-h-52 overflow-y-auto rounded-lg border border-[var(--app-border)]"
            >
              {results.map((location, index) => (
                <button
                  key={location.id}
                  id={listId + "-" + index}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  disabled={disabled}
                  tabIndex={-1}
                  onClick={() => choose(location)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "block w-full border-b border-[var(--app-border)] px-3 py-3 text-left last:border-0",
                    index === activeIndex && "bg-[var(--app-accent-soft)]",
                  )}
                >
                  <span className="block break-words text-sm font-medium">
                    {location.name}
                  </span>
                  <span className="text-xs text-[var(--app-muted)]">
                    {location.type || "Location"} ·{" "}
                    {location.sections
                      .reduce((sum, s) => sum + s.quantity, 0)
                      .toLocaleString()}{" "}
                    cards
                    {location.defaultSectionNames?.length
                      ? ` · ${location.defaultSectionNames.length} sections`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
            <p role="status" className="text-xs text-[var(--app-muted)]">
              {matches.length === 0
                ? "No destinations found. Try a different name or storage path."
                : matches.length > 30
                  ? "Showing 30 of " +
                    matches.length +
                    " destinations. Keep typing to narrow the list."
                  : matches.length +
                    " destinations · ↑ ↓ to browse · Enter to choose"}
            </p>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--app-accent)] bg-[var(--app-accent-soft)] p-3">
            <div className="min-w-0">
              <span className="text-xs text-[var(--app-muted)]">
                {destination.type || "Location"}
              </span>
              <p className="break-words font-semibold">{destination.name}</p>
              {destination.capacity != null && (
                <p className="text-sm">
                  {destination.quantity ?? 0} / {destination.capacity} cards
                  overall
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={disabled}
              className={filterButtonClass}
              onClick={() => {
                setChoosing(true);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              Change
            </button>
          </div>
        )}
      </div>
      {destination && !choosing && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              ref={sectionHeadingRef}
              tabIndex={-1}
              className="text-sm font-semibold outline-none"
            >
              2. Section
            </h3>
            {destination.sections.some((s) => s.capacity !== null) && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={onlyWithRoom}
                  disabled={disabled}
                  onChange={(event) => setOnlyWithRoom(event.target.checked)}
                />
                Only sections with room
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sections.map((s) => (
              <button
                key={s.name}
                type="button"
                aria-pressed={section === s.name}
                disabled={disabled}
                onClick={() => {
                  onSectionChange(s.name);
                  setCustomSection(false);
                }}
                className={cn(
                  "min-w-0 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--app-focus)]",
                  section === s.name
                    ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                    : "border-[var(--app-border)] hover:bg-[var(--app-surface-3)]",
                )}
              >
                <span className="flex justify-between gap-1 break-words text-sm font-semibold">
                  {s.name}
                  <span aria-hidden="true">
                    {section === s.name ? "✓" : ""}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-[var(--app-muted)]">
                  {spaceLabel(s)}
                </span>
                {s.capacity !== null && (
                  <span
                    aria-hidden="true"
                    className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--app-border)]"
                  >
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        s.quantity > s.capacity ? "bg-amber-500" : "bg-sky-500",
                      )}
                      style={{
                        width:
                          Math.min(100, (s.quantity / s.capacity) * 100) + "%",
                      }}
                    />
                  </span>
                )}
              </button>
            ))}
          </div>
          {onlyWithRoom && !sections.length && (
            <p role="status" className="text-sm text-[var(--app-muted)]">
              All sections are full. Turn off the filter to choose one anyway,
              or add a section.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={!section && !customSection}
              className={cn(
                filterButtonClass,
                !section && !customSection && "!border-[var(--app-accent)]",
              )}
              onClick={() => {
                onSectionChange("");
                setCustomSection(false);
              }}
            >
              No section
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={customSection}
              className={filterButtonClass}
              onClick={() => setCustomSection(true)}
            >
              + Custom section
            </button>
          </div>
          {customSection && (
            <label className="block text-sm">
              Section name
              <input
                aria-label="Section name"
                autoFocus
                value={section}
                onChange={(event) => onSectionChange(event.target.value)}
                maxLength={100}
                disabled={disabled}
                className={cn(filterInputClass, "mt-1 w-full")}
                placeholder="Type a new or existing section name"
              />
            </label>
          )}
          <p className="text-xs text-[var(--app-muted)]">
            {section
              ? "Selected: " + section + ". "
              : "No section — cards will go directly into this location."}
            {" Capacity is a guide, not a limit."}
          </p>
          {selectedSection && (
            <p role="status" className="text-sm">
              {spaceLabel(selectedSection)}
              {projected !== undefined ? " → " + projected + " after move" : ""}
            </p>
          )}
          {destination.capacity != null && (
            <p role="status" className="text-sm">
              {incomingQuantity === undefined
                ? `${destination.quantity ?? 0} / ${destination.capacity} cards overall`
                : `Up to ${(destination.quantity ?? 0) + Math.max(0, incomingQuantity - alreadyInLocation)} / ${destination.capacity} cards overall after move`}
              {(destination.quantity ?? 0) +
                Math.max(0, (incomingQuantity ?? 0) - alreadyInLocation) >
              destination.capacity
                ? " — All cards may not fit. You can still continue."
                : ""}
            </p>
          )}
          {selectedSection?.capacity != null &&
            (projected ?? selectedSection.quantity) >
              selectedSection.capacity && (
              <p
                role="status"
                className="rounded-lg border border-amber-600 bg-amber-500/10 p-3 text-sm text-amber-500"
              >
                All cards may not fit:{" "}
                {(projected ?? selectedSection.quantity) -
                  selectedSection.capacity}{" "}
                over the advisory capacity. You can still continue.
              </p>
            )}
        </div>
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
