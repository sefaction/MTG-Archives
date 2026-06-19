"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterPanelClass,
  filterPrimaryButtonClass,
} from "./filterStyles";

type InventoryQuickCardNameSearchProps = {
  actionPath: string;
  params: Record<string, string | string[] | undefined>;
  suggestionsEndpoint?: string;
};

type AutocompleteOption = {
  value: string;
  label: string;
  description?: string;
};

const OMITTED_PARAMS = new Set(["cardName", "page"]);
const INVENTORY_SCROLL_STORAGE_KEY = "mtg-inventory-scroll-y";

function paramEntries(params: InventoryQuickCardNameSearchProps["params"]) {
  return Object.entries(params).flatMap(([key, value]) => {
    if (OMITTED_PARAMS.has(key) || value === undefined) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => [key, String(entry)] as const);
  });
}

function first(
  params: InventoryQuickCardNameSearchProps["params"],
  key: string,
) {
  const value = params[key];
  if (Array.isArray(value)) return value[0] || "";
  return value ? String(value) : "";
}

export function InventoryQuickCardNameSearch({
  actionPath,
  params,
  suggestionsEndpoint = actionPath.startsWith("/public")
    ? "/api/inventory/filter-suggestions?public=1"
    : "/api/inventory/filter-suggestions",
}: InventoryQuickCardNameSearchProps) {
  const router = useRouter();
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const entries = paramEntries(params);
  const cardName = first(params, "cardName");
  const [value, setValue] = useState(cardName);
  const [suggestions, setSuggestions] = useState<AutocompleteOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const clearParams = new URLSearchParams();
  entries.forEach(([key, entryValue]) => clearParams.append(key, entryValue));
  clearParams.set("page", "1");
  const clearHref = `${actionPath}?${clearParams.toString()}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => setValue(cardName), 0);
    return () => window.clearTimeout(timeout);
  }, [cardName]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 1) {
      const timeout = window.setTimeout(() => {
        setSuggestions([]);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(suggestionsEndpoint, window.location.origin);
        const current = new URLSearchParams(window.location.search);
        current.forEach((paramValue, key) => {
          if (!url.searchParams.has(key))
            url.searchParams.append(key, paramValue);
        });
        url.searchParams.set("kind", "cardName");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "12");
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestion request failed.");
        const payload = (await response.json()) as {
          suggestions?: AutocompleteOption[];
        };
        setSuggestions(payload.suggestions || []);
        setHighlighted(0);
      } catch (error) {
        if (!controller.signal.aborted) setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [suggestionsEndpoint, value]);

  function buildUrl(nextCardName: string) {
    const next = new URLSearchParams();
    entries.forEach(([key, entryValue]) => next.append(key, entryValue));
    const clean = nextCardName.trim();
    if (clean) next.set("cardName", clean);
    next.set("page", "1");
    const query = next.toString();
    return query ? `${actionPath}?${query}` : actionPath;
  }

  function navigateWithCardName(nextCardName: string) {
    window.sessionStorage.setItem(
      INVENTORY_SCROLL_STORAGE_KEY,
      String(window.scrollY),
    );
    router.replace(buildUrl(nextCardName), { scroll: false });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateWithCardName(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setHighlighted(
        (current) => (current - 1 + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (event.key === "Enter" && open && suggestions[highlighted]) {
      event.preventDefault();
      navigateWithCardName(suggestions[highlighted].value);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <section className={cn(filterPanelClass, "space-y-2")}>
      <form
        action={actionPath}
        method="get"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="page" value="1" />
        {entries.map(([key, entryValue], index) => (
          <input
            key={`${key}-${entryValue}-${index}`}
            type="hidden"
            name={key}
            value={entryValue}
          />
        ))}
        <label
          className="relative block flex-1 text-xs font-medium text-zinc-300"
          htmlFor={inputId}
        >
          Quick card name search
          <input
            id={inputId}
            name="cardName"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            placeholder="Search card name…"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls={open && suggestions.length ? listId : undefined}
            aria-expanded={open && suggestions.length ? "true" : "false"}
            className={cn(filterInputClass, "mt-1 w-full")}
          />
          {open && (suggestions.length || loading) ? (
            <div
              id={listId}
              role="listbox"
              className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-700 bg-zinc-950 p-1 text-sm shadow-xl shadow-black/30"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.value}-${suggestion.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={`block w-full rounded px-2 py-1.5 text-left ${
                    index === highlighted
                      ? "bg-sky-950 text-sky-100"
                      : "hover:bg-zinc-800"
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    navigateWithCardName(suggestion.value);
                  }}
                >
                  <span className="block font-medium">{suggestion.label}</span>
                  {suggestion.description ? (
                    <span className="block text-xs text-zinc-400">
                      {suggestion.description}
                    </span>
                  ) : null}
                </button>
              ))}
              {loading ? (
                <div className="px-2 py-1.5 text-xs text-zinc-400">
                  Loading suggestions…
                </div>
              ) : null}
            </div>
          ) : null}
        </label>
        <div className="flex gap-2">
          <button className={filterPrimaryButtonClass}>Search</button>
          {cardName ? (
            <a className={filterButtonClass} href={clearHref}>
              Clear
            </a>
          ) : null}
        </div>
      </form>
    </section>
  );
}
