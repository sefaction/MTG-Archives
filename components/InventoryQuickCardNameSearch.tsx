"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useInventoryWorkspace } from "./InventoryWorkspace";
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
  const workspace = useInventoryWorkspace();
  const [localValue, setLocalValue] = useState(cardName);
  const value = workspace?.cardName ?? localValue;
  const setValue = workspace?.setCardName ?? setLocalValue;
  // A reply belongs to the query and filter scope that requested it. Hide it
  // immediately when either changes, including the debounce before a new fetch.
  const suggestionKey = JSON.stringify([
    suggestionsEndpoint,
    params,
    value.trim(),
  ]);
  const [suggestionResult, setSuggestionResult] = useState<{
    key: string;
    options: AutocompleteOption[];
  } | null>(null);
  const suggestions =
    value.trim() && suggestionResult?.key === suggestionKey
      ? suggestionResult.options
      : [];
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const loading = Boolean(value.trim()) && loadingKey === suggestionKey;
  const clearParams = new URLSearchParams();
  entries.forEach(([key, entryValue]) => clearParams.append(key, entryValue));
  clearParams.set("page", "1");
  const clearHref = `${actionPath}?${clearParams.toString()}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => setLocalValue(cardName), 0);
    return () => window.clearTimeout(timeout);
  }, [cardName]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 1) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingKey(suggestionKey);
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
        if (controller.signal.aborted) return;
        setSuggestionResult({
          key: suggestionKey,
          options: payload.suggestions || [],
        });
        setHighlighted(0);
      } catch (error) {
        if (!controller.signal.aborted)
          setSuggestionResult({ key: suggestionKey, options: [] });
      } finally {
        if (!controller.signal.aborted) setLoadingKey(null);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [suggestionsEndpoint, suggestionKey, value]);

  function buildUrl(nextCardName: string) {
    const next = new URLSearchParams();
    const filters = workspace
      ? document.getElementById("inventory-workspace-filters")
      : null;
    if (filters instanceof HTMLFormElement) {
      new FormData(filters).forEach((value, key) => {
        const clean = String(value).trim();
        if (clean && key !== "cardName") next.append(key, clean);
      });
    } else entries.forEach(([key, entryValue]) => next.append(key, entryValue));
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
    if (workspace) router.push(buildUrl(nextCardName), { scroll: false });
    else router.replace(buildUrl(nextCardName), { scroll: false });
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
    <section
      className={
        workspace ? "inventory-quick-search" : cn(filterPanelClass, "space-y-2")
      }
    >
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
