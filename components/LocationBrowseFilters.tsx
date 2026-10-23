"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  locationBrowseHref,
  type LocationBrowseParams,
} from "@/lib/location-browser";
import {
  cn,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "./filterStyles";

export function LocationBrowseFilters({
  params,
  types = [],
  deck = false,
}: {
  params: LocationBrowseParams;
  types?: string[];
  deck?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(params.q ?? "");
  const [filters, setFilters] = useState(params);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  // Keep a local draft across server responses, so an earlier query response
  // cannot overwrite what the user is typing next.
  const draft = useRef(params);
  const receivedHref = locationBrowseHref(params).split("#")[0];
  const previousHref = useRef(receivedHref);
  const ownNavigations = useRef(new Set<string>());
  const latestNavigation = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const reset = (next: LocationBrowseParams) => {
      if (timer.current) clearTimeout(timer.current);
      composing.current = false;
      ownNavigations.current.clear();
      latestNavigation.current = null;
      setQuery(next.q ?? "");
      setFilters(next);
      draft.current = next;
    };
    if (receivedHref !== previousHref.current) {
      previousHref.current = receivedHref;
      // Own responses acknowledge submitted URLs without erasing later edits.
      // Client navigation from the main Locations link replaces the scope.
      if (!ownNavigations.current.delete(receivedHref)) reset(params);
      else if (receivedHref === latestNavigation.current) {
        ownNavigations.current.clear();
        latestNavigation.current = null;
      }
    }
    const restoreHistory = () => {
      const next = Object.fromEntries(new URLSearchParams(window.location.search));
      // The history event restores this URL before its server props arrive.
      // Acknowledge it now so those props cannot erase subsequent edits.
      previousHref.current = locationBrowseHref(next).split("#")[0];
      reset(next);
    };
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, [params, receivedHref]);

  function navigate(changes: Partial<LocationBrowseParams>, delay = 0) {
    if (timer.current) clearTimeout(timer.current);
    draft.current = {
      ...draft.current,
      ...changes,
      page: undefined,
      treePage: undefined,
      selected: undefined,
      edit: undefined,
      panel: undefined,
    };
    setFilters(draft.current);
    const href = locationBrowseHref(draft.current).split("#")[0];
    timer.current = setTimeout(
      () => {
        if (href !== previousHref.current) {
          ownNavigations.current.add(href);
          latestNavigation.current = href;
        }
        startTransition(() => router.replace(href, { scroll: false }));
      },
      delay,
    );
  }

  return (
    <form
      action="/locations"
      method="get"
      className="space-y-3"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        navigate({ q: query });
      }}
    >
      {params.parent && (
        <input type="hidden" name="parent" value={params.parent} />
      )}
      {deck && <input type="hidden" name="view" value="decks" />}
      <div className="locations-search">
        <label className="min-w-0 text-sm">
          {deck
            ? "Search deck locations"
            : `Search locations${params.parent ? " in this branch" : ""}`}
          <input
            name="q"
            value={query}
            placeholder="Name, full storage path, or type"
            className={cn(filterInputClass, "mt-1 w-full")}
            onCompositionStart={() => {
              composing.current = true;
              if (timer.current) clearTimeout(timer.current);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              navigate({ q: event.currentTarget.value }, 250);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!composing.current) navigate({ q: event.target.value }, 250);
            }}
          />
        </label>
        <button className={filterPrimaryButtonClass}>
          {deck ? "Find decks" : "Find locations"}
        </button>
      </div>
      {!deck && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 max-w-full text-sm">
            Space
            <select
              name="space"
              aria-label="Space"
              value={filters.space ?? ""}
              className={cn(filterSelectClass, "mt-1 block max-w-full")}
              onChange={(event) =>
                navigate({ space: event.target.value, q: query })
              }
            >
              <option value="">Any space</option>
              <option value="available">Space remaining</option>
              <option value="full">Full or over capacity</option>
              <option value="empty">Empty locations</option>
              <option value="unknown">Capacity not set</option>
            </select>
          </label>
          <label className="min-w-0 max-w-full text-sm">
            Type
            <select
              name="type"
              aria-label="Type"
              value={filters.type ?? ""}
              className={cn(filterSelectClass, "mt-1 block max-w-full")}
              onChange={(event) =>
                navigate({ type: event.target.value, q: query })
              }
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 max-w-full text-sm">
            Status
            <select
              name="status"
              aria-label="Status"
              value={filters.status ?? ""}
              className={cn(filterSelectClass, "mt-1 block max-w-full")}
              onChange={(event) =>
                navigate({ status: event.target.value, q: query })
              }
            >
              <option value="">Active and inactive</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--app-muted)]">
        <span role="status">
          {pending ? "Updating locations…" : "Results update as you type."}
        </span>
        {(params.q ||
          params.parent ||
          params.type ||
          params.space ||
          params.status) && (
          <a
            href={deck ? "/locations?view=decks" : "/locations"}
            className="py-1 underline"
          >
            Clear filters{params.parent ? " and branch" : ""}
          </a>
        )}
      </div>
    </form>
  );
}
