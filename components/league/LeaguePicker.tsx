"use client";

import { useState } from "react";

type Option = { value: string; label: string; disabled?: boolean };
export function LeaguePicker({
  name,
  label,
  options,
  multiple = false,
  initialSelected = [],
}: {
  name: string;
  label: string;
  options: Option[];
  multiple?: boolean;
  initialSelected?: string[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialSelected);
  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <label className="block text-sm">
        <span className="app-muted">Search {label.toLowerCase()}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
        />
      </label>
      {multiple ? (
        <>
          {/* Keep checked choices submitted even when filtered out of the list. */}
          {selected
            .filter(
              (value) =>
                !visible.some((option) => option.value === value) &&
                !options.find((option) => option.value === value)?.disabled,
            )
            .map((value) => (
              <input key={value} type="hidden" name={name} value={value} />
            ))}
          <div
            className="max-h-52 space-y-2 overflow-auto"
            role="group"
            aria-label={label}
          >
            {visible.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-2 break-words text-sm"
              >
                <input
                  type="checkbox"
                  name={name}
                  value={option.value}
                  aria-label={option.label}
                  checked={selected.includes(option.value)}
                  disabled={option.disabled}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
            {!visible.length ? (
              <p className="app-muted text-sm">No matching choices.</p>
            ) : null}
          </div>
          <p className="app-muted text-xs">
            {selected.length} selected · selections stay checked while searching
          </p>
        </>
      ) : (
        <label className="block text-sm">
          <span className="sr-only">{label}</span>
          <select
            name={name}
            required
            value={selected[0] || ""}
            onChange={(event) =>
              setSelected(event.target.value ? [event.target.value] : [])
            }
            className="w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
          >
            <option value="">Choose {label.toLowerCase()}</option>
            {options
              .filter(
                (option) =>
                  visible.includes(option) || selected.includes(option.value),
              )
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}
