"use client";

import { useState } from "react";
import { MAX_STORAGE_SECTIONS, type StorageLayout } from "@/lib/storage-layout";
import { cn, filterButtonClass, filterInputClass } from "./filterStyles";

export function StorageLayoutFields({
  value,
  onChange,
}: {
  value: StorageLayout;
  onChange: (layout: StorageLayout) => void;
}) {
  const [mode, setMode] = useState(
    value.sections.length
      ? "sections"
      : value.capacity !== null
        ? "single"
        : "none",
  );
  const [count, setCount] = useState(String(value.sections.length || 6));
  const [prefix, setPrefix] = useState("Section");
  const [commonCapacity, setCommonCapacity] = useState("85");
  const [error, setError] = useState("");
  const numberValue = (value: string) => (value === "" ? null : Number(value));
  return (
    <div className="space-y-4">
      <input type="hidden" name="storageLayout" value={JSON.stringify(value)} />
      <input type="hidden" name="storageMode" value={mode} />
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Storage structure"
      >
        {[
          ["none", "No capacity tracking"],
          ["single", "One space"],
          ["sections", "Divided into sections"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={mode === id}
            className={cn(
              filterButtonClass,
              mode === id &&
                "!border-[var(--app-accent)] !bg-[var(--app-accent-soft)]",
            )}
            onClick={() => {
              setMode(id);
              setError("");
              onChange(
                id === "none"
                  ? { capacity: null, sections: [] }
                  : id === "single"
                    ? { capacity: value.capacity, sections: [] }
                    : { ...value, sections: value.sections },
              );
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "none" && (
        <p className="text-sm text-[var(--app-muted)]">
          Just name the location. You can still place cards in named sections
          later.
        </p>
      )}
      {mode === "single" && (
        <label className="block text-sm">
          Location capacity (cards)
          <input
            type="number"
            min="1"
            max="2147483647"
            step="1"
            required
            value={value.capacity ?? ""}
            className={cn(filterInputClass, "mt-1 block w-full sm:max-w-xs")}
            onChange={(event) =>
              onChange({ ...value, capacity: numberValue(event.target.value) })
            }
          />
        </label>
      )}
      {mode === "sections" && (
        <>
          <details open={!value.sections.length}>
            <summary className="cursor-pointer py-2 text-sm font-medium">
              {value.sections.length
                ? "Generate a different section layout"
                : "Set up your sections"}
            </summary>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--app-border)] p-3">
              <label className="min-w-0 text-sm">
                Number of sections
                <input
                  aria-label="Number of sections"
                  type="number"
                  min="1"
                  max={MAX_STORAGE_SECTIONS}
                  step="1"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  className={cn(filterInputClass, "mt-1 block w-28 max-w-full")}
                />
              </label>
              <label className="min-w-0 text-sm">
                Name prefix
                <input
                  value={prefix}
                  maxLength={80}
                  onChange={(event) => setPrefix(event.target.value)}
                  className={cn(filterInputClass, "mt-1 block w-40 max-w-full")}
                />
              </label>
              <label className="min-w-0 text-sm">
                Cards per section (optional)
                <input
                  type="number"
                  min="1"
                  max="2147483647"
                  step="1"
                  value={commonCapacity}
                  onChange={(event) => setCommonCapacity(event.target.value)}
                  className={cn(filterInputClass, "mt-1 block w-40 max-w-full")}
                />
              </label>
              <button
                type="button"
                className={filterButtonClass}
                onClick={() => {
                  const length = Number(count),
                    capacity = numberValue(commonCapacity);
                  if (
                    !Number.isInteger(length) ||
                    length < 1 ||
                    length > MAX_STORAGE_SECTIONS ||
                    !prefix.trim() ||
                    (capacity !== null &&
                      (!Number.isInteger(capacity) ||
                        capacity < 1 ||
                        capacity > 2147483647))
                  ) {
                    setError(
                      "Enter a section count from 1 to 100, a name prefix and a positive whole-number capacity (or leave capacity blank).",
                    );
                    return;
                  }
                  if (
                    value.sections.length &&
                    !window.confirm(
                      "Replace these draft section settings? Existing card placements will not be changed.",
                    )
                  )
                    return;
                  onChange({
                    ...value,
                    sections: Array.from({ length }, (_, i) => ({
                      name: `${prefix.trim()} ${i + 1}`,
                      capacity,
                    })),
                  });
                  setError("");
                }}
              >
                {value.sections.length
                  ? "Regenerate sections"
                  : "Generate sections"}
              </button>
            </div>
          </details>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          {value.sections.length > 0 && (
            <div
              className="max-h-80 space-y-2 overflow-y-auto pr-1"
              aria-label="Default sections"
            >
              <p className="text-sm text-[var(--app-muted)]">
                Customize any name or capacity. Blank capacity means unknown.
              </p>
              {value.sections.map((section, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
                >
                  <label className="min-w-0 text-sm">
                    Section {index + 1} name
                    <input
                      maxLength={100}
                      required
                      value={section.name}
                      className={cn(filterInputClass, "mt-1 w-full")}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          sections: value.sections.map((row, i) =>
                            i === index
                              ? { ...row, name: event.target.value }
                              : row,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    Section {index + 1} capacity
                    <input
                      type="number"
                      min="1"
                      max="2147483647"
                      step="1"
                      value={section.capacity ?? ""}
                      className={cn(filterInputClass, "mt-1 w-full")}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          sections: value.sections.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  capacity: numberValue(event.target.value),
                                }
                              : row,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove section ${index + 1}`}
                    className={filterButtonClass}
                    onClick={() =>
                      onChange({
                        ...value,
                        sections: value.sections.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm">
              Optional overall capacity
            </summary>
            <label className="mt-2 block text-sm">
              Location capacity (cards)
              <input
                type="number"
                min="1"
                max="2147483647"
                step="1"
                value={value.capacity ?? ""}
                className={cn(
                  filterInputClass,
                  "mt-1 block w-full sm:max-w-xs",
                )}
                onChange={(event) =>
                  onChange({
                    ...value,
                    capacity: numberValue(event.target.value),
                  })
                }
              />
            </label>
            <p className="text-sm text-[var(--app-muted)]">
              Counts all cards directly here, including unsectioned cards.
              Sub-locations are separate.
            </p>
          </details>
        </>
      )}
      <p className="text-sm text-[var(--app-muted)]">
        Capacity is a guide, not a limit. Moves and imports remain allowed when
        full.
      </p>
    </div>
  );
}

export function LocationLayoutEditor({
  initialValue,
}: {
  initialValue: StorageLayout;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <details className="md:col-span-2">
      <summary className="cursor-pointer py-2 font-medium">
        Storage layout and capacity
      </summary>
      <p className="mb-3 text-sm text-[var(--app-muted)]">
        These settings affect only this location. Renaming or removing a default
        section does not rename or move cards already stored there.
      </p>
      <StorageLayoutFields value={value} onChange={setValue} />
    </details>
  );
}
