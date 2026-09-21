"use client";

import { useId, useState } from "react";
import { cn, filterInputClass, filterSelectClass } from "./filterStyles";

type Option = { id: string; name: string };

/** Bounded native listbox: search full paths without thousands of DOM options. */
export function LocationSearchSelect({
  locations,
  name,
  label,
  defaultValue = "",
  value,
  onChange,
  emptyLabel = "No parent (top level)",
  required = false,
  disabled = false,
}: {
  locations: Option[];
  name: string;
  label: string;
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [localValue, setLocalValue] = useState(defaultValue);
  const selectedId = value ?? localValue;
  const selected = locations.find((location) => location.id === selectedId);
  const matches = locations.filter((location) =>
    location.name
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const options = matches.slice(0, 30);
  // Searching must not silently clear a saved parent or destination.
  if (selected && !options.some((option) => option.id === selected.id))
    options.unshift(selected);
  return (
    <div className="min-w-0 space-y-1 text-sm" data-location-picker>
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        type="search"
        aria-label={`Search ${label.toLowerCase()} options`}
        placeholder="Search storage paths…"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        className={cn(filterInputClass, "w-full")}
      />
      <select
        id={id}
        name={name}
        value={selectedId}
        required={required}
        disabled={disabled}
        size={Math.min(6, Math.max(2, options.length + 1))}
        aria-describedby={id + "-status"}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChange?.(event.target.value);
        }}
        className={cn(filterSelectClass, "w-full")}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <p
        id={id + "-status"}
        className="text-xs text-[var(--app-muted)]"
        role="status"
      >
        {matches.length > 30
          ? `First 30 of ${matches.length} matches. Narrow your search.`
          : `${matches.length} matches.`}
        {selected ? ` Selected: ${selected.name}` : ""}
      </p>
    </div>
  );
}

export function NewLocationParentFields({
  owners,
  locations,
  defaultOwnerId,
  defaultParentId = "",
}: {
  owners?: Option[];
  locations: (Option & { ownerPlayerId: string })[];
  defaultOwnerId: string;
  defaultParentId?: string;
}) {
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [parentId, setParentId] = useState(defaultParentId);
  return (
    <>
      {owners ? (
        <label className="space-y-1 text-sm">
          Owner
          <select
            name="ownerPlayerId"
            value={ownerId}
            className={cn(filterSelectClass, "block w-full")}
            onChange={(event) => {
              setOwnerId(event.target.value);
              setParentId("");
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
        <input type="hidden" name="ownerPlayerId" value={ownerId} />
      )}
      <LocationSearchSelect
        name="parentLocationId"
        label="Parent location"
        locations={locations.filter(
          (location) => location.ownerPlayerId === ownerId,
        )}
        value={parentId}
        onChange={setParentId}
      />
    </>
  );
}
