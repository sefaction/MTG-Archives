"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InventoryCardDetails, type InventoryRow } from "./InventoryBrowser";
import {
  collectionCardGridClass,
  normalizeCollectionCardSize,
  type CollectionCardSize,
} from "./cardGrid";
import { getInventoryCardImagePair } from "@/lib/inventory-card-images";
import {
  filterButtonClass,
  filterInputClass,
  filterSelectClass,
  cn,
} from "./filterStyles";
import type { PullScope, PullBrowse } from "@/lib/pull-scope";
export type PullRow = {
  id: string;
  itemId?: string;
  name: string;
  quantity: number;
  printing: string;
  finish: string;
  language: string;
  condition: string;
  locationId: string;
  location: string;
  section: string | null;
  destination?: string;
  pulled: number;
  owned?: number;
  keep?: number;
  card: InventoryRow;
};
export function PullWorkspace({
  rows,
  selection,
  onSelection,
  onPulled,
  onPrinting,
  onSkip,
  scope,
  onScope,
  locations = [],
  disabled = false,
  bulk = false,
  children,
  server,
}: {
  rows: PullRow[];
  selection: Record<string, number>;
  onSelection: (value: Record<string, number>) => void;
  onPulled: (row: PullRow, quantity: number) => void;
  onPrinting?: (row: PullRow) => void;
  onSkip?: (row: PullRow) => void;
  scope: PullScope;
  onScope: (scope: PullScope) => void;
  locations?: Array<{ id: string; name: string; isBulk?: boolean }>;
  disabled?: boolean;
  bulk?: boolean;
  children?: ReactNode;
  server?: {
    page: number;
    pages: number;
    total: number;
    pulled?: number;
    pageSize: number;
    onPage: (page: number) => void;
    onBrowse: (browse: PullBrowse) => void;
  };
}) {
  const [view, setView] = useState<"table" | "binder">("table"),
    [size, setSize] = useState<CollectionCardSize>("medium"),
    [layout, setLayout] = useState("inventory"),
    [query, setQuery] = useState(""),
    [box, setBox] = useState(""),
    [sort, setSort] = useState("location"),
    [desc, setDesc] = useState(false),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(server?.pageSize ?? 25),
    [detail, setDetail] = useState<InventoryRow | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setView(
          localStorage.getItem("inventoryViewMode") === "binder"
            ? "binder"
            : "table",
        );
        setSize(
          normalizeCollectionCardSize(
            localStorage.getItem("inventoryCardSize"),
          ),
        );
        setLayout(
          localStorage.getItem("huntLayout") === "boxes"
            ? "boxes"
            : "inventory",
        );
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const serverBrowse = useRef(server?.onBrowse);
  useEffect(() => {
    serverBrowse.current = server?.onBrowse;
  }, [server?.onBrowse]);
  useEffect(() => {
    if (!serverBrowse.current) return;
    const timer = setTimeout(
      () =>
        serverBrowse.current?.({
          search: query,
          sort: sort as PullBrowse["sort"],
          desc,
          locationId: box,
          pageSize,
        }),
      200,
    );
    return () => clearTimeout(timer);
  }, [query, sort, desc, box, pageSize]);
  function resetBox() {
    setBox("");
    setPage(1);
    server?.onBrowse({
      search: query,
      sort: sort as PullBrowse["sort"],
      desc,
      locationId: "",
      pageSize,
    });
  }
  function applyScope(next: PullScope) {
    resetBox();
    onScope(next);
  }
  const [seen, setSeen] = useState<Record<string, string>>({});
  function remember(row: PullRow) {
    setSeen((previous) => ({
      ...previous,
      [row.itemId ?? row.id]:
        `${row.name} ${row.printing} from ${row.location}`,
    }));
  }
  const filtered = useMemo(
    () =>
      server
        ? rows
        : rows
            .filter(
              (row) =>
                (!box || row.locationId === box) &&
                [
                  row.name,
                  row.printing,
                  row.location,
                  row.section,
                  row.destination,
                  row.finish,
                ].some((value) =>
                  String(value ?? "")
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
                ),
            )
            .sort((a, b) => {
              const value =
                sort === "quantity"
                  ? a.quantity - b.quantity
                  : sort === "name"
                    ? a.name.localeCompare(b.name, undefined, { numeric: true })
                    : `${a.location} ${a.section ?? ""} ${a.name}`.localeCompare(
                        `${b.location} ${b.section ?? ""} ${b.name}`,
                        undefined,
                        { numeric: true },
                      );
              return (desc ? -value : value) || a.id.localeCompare(b.id);
            }),
    [rows, box, query, sort, desc, server],
  );
  const pages =
      server?.pages ?? Math.max(1, Math.ceil(filtered.length / pageSize)),
    current = server?.page ?? Math.min(page, pages),
    visible = server
      ? rows
      : filtered.slice((current - 1) * pageSize, current * pageSize);
  const boxes = server
    ? locations
    : [
        ...new Map(
          rows.map((row) => [
            row.locationId,
            { id: row.locationId, name: row.location },
          ]),
        ).values(),
      ];
  function select(row: PullRow, value: number) {
    onSelection({
      ...selection,
      [row.id]: Math.max(0, Math.min(row.quantity, Math.floor(value) || 0)),
    });
  }
  const quantity = (row: PullRow) => (
    <input
      aria-label={`Pull quantity for ${row.name}, ${row.printing}, ${row.finish}, ${row.location}${row.section ? ` / ${row.section}` : ""}`}
      type="number"
      min={0}
      max={row.quantity}
      value={selection[row.id] ?? 0}
      disabled={disabled}
      onChange={(event) => select(row, Number(event.target.value))}
      className={cn(filterInputClass, "w-20")}
    />
  );
  const controls = (row: PullRow) => (
    <details className="relative">
      <summary
        className={cn(filterButtonClass, "cursor-pointer list-none")}
        aria-label={`Pull options for ${row.name}`}
      >
        More
      </summary>
      <div className="mt-2 flex max-w-sm flex-col items-start gap-2 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2">
        {onPrinting && (
          <button
            type="button"
            disabled={disabled || row.pulled >= row.quantity}
            className={filterButtonClass}
            onClick={() => {
              remember(row);
              resetBox();
              onPrinting(row);
            }}
          >
            {bulk
              ? "Keep this stack / choose other copies"
              : "Select another printing"}
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            className={filterButtonClass}
            disabled={disabled || row.pulled >= row.quantity}
            onClick={() => {
              remember(row);
              resetBox();
              onSkip(row);
            }}
          >
            Not found here
          </button>
        )}
        <button
          type="button"
          className={filterButtonClass}
          disabled={disabled}
          onClick={() =>
            onPulled(row, row.pulled ? 0 : selection[row.id] || row.quantity)
          }
        >
          {row.pulled ? "Unmark pulled" : "Mark pulled"}
        </button>
        <button
          type="button"
          className={filterButtonClass}
          disabled={disabled}
          onClick={() =>
            applyScope({
              ...scope,
              excludedLocations: [
                ...new Set([
                  ...(scope.excludedLocations ?? []),
                  row.locationId,
                ]),
              ],
            })
          }
        >
          Exclude this location and re-evaluate
        </button>
        {row.section && (
          <button
            type="button"
            className={filterButtonClass}
            disabled={disabled}
            onClick={() =>
              applyScope({
                ...scope,
                excludedSections: [
                  ...(scope.excludedSections ?? []).filter(
                    (value) =>
                      value.locationId !== row.locationId ||
                      value.section !== row.section,
                  ),
                  { locationId: row.locationId, section: row.section! },
                ],
              })
            }
          >
            Exclude this section and re-evaluate
          </button>
        )}
      </div>
    </details>
  );
  return (
    <div
      className="space-y-3 min-w-0"
      aria-label={bulk ? "Bulk pull workspace" : "Card Hunt workspace"}
    >
      <div className="inventory-quick-search">
        <label className="block text-xs font-medium text-zinc-300">
          Search cards, boxes or destinations
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Search card name…"
          />
        </label>
      </div>
      <div className="inventory-results min-w-0 space-y-3">
        <div className="inventory-view-toolbar flex flex-wrap items-center gap-2">
          <span className="text-sm">View:</span>
          {(["table", "binder"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={view === value}
              className={cn(
                filterButtonClass,
                view === value && "!bg-[var(--app-accent-soft)]",
              )}
              onClick={() => {
                setView(value);
                try {
                  localStorage.setItem("inventoryViewMode", value);
                } catch {}
              }}
            >
              {value === "table" ? "Table View" : "Binder View"}
            </button>
          ))}
          <select
            aria-label="Hunt layout"
            value={layout}
            className={filterSelectClass}
            onChange={(event) => {
              setLayout(event.target.value);
              try {
                localStorage.setItem("huntLayout", event.target.value);
              } catch {}
            }}
          >
            <option value="inventory">Inventory workspace</option>
            <option value="boxes">Box-by-box</option>
          </select>
          <label className="text-sm">
            Sort by{" "}
            <select
              aria-label="Sort pulls by"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
              className={filterSelectClass}
            >
              <option value="location">Box / section</option>
              <option value="name">Card name</option>
              <option value="quantity">Pull quantity</option>
            </select>
          </label>
          <button
            type="button"
            className={filterButtonClass}
            onClick={() => setDesc(!desc)}
          >
            {desc ? "Descending" : "Ascending"}
          </button>
          <details>
            <summary className={filterButtonClass}>View options</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {view === "binder" &&
                (["small", "medium", "large"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={size === value}
                    className={filterButtonClass}
                    onClick={() => {
                      setSize(value);
                      try {
                        localStorage.setItem("inventoryCardSize", value);
                      } catch {}
                    }}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              <label>
                Page size{" "}
                <select
                  aria-label="Pull page size"
                  className={filterSelectClass}
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {[25, 50, 100, 250].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
        <details>
          <summary className="text-sm text-[var(--app-accent)]">
            Locations and exclusions (
            {(scope.excludedLocations?.length ?? 0) +
              (scope.excludedSections?.length ?? 0) +
              (scope.excludedItems?.length ?? 0)}
            )
          </summary>
          <div className="my-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="Exclude hunt location"
              defaultValue=""
              disabled={disabled}
              className={filterSelectClass}
              onChange={(event) => {
                if (event.target.value)
                  applyScope({
                    ...scope,
                    excludedLocations: [
                      ...new Set([
                        ...(scope.excludedLocations ?? []),
                        event.target.value,
                      ]),
                    ],
                  });
                event.target.value = "";
              }}
            >
              <option value="">Exclude a location…</option>
              {locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.isBulk ? " · Bulk" : ""}
                </option>
              ))}
            </select>
            {(scope.excludedLocations ?? []).map((id) => (
              <button
                type="button"
                className={filterButtonClass}
                key={id}
                disabled={disabled}
                onClick={() =>
                  applyScope({
                    ...scope,
                    excludedLocations: scope.excludedLocations?.filter(
                      (value) => value !== id,
                    ),
                  })
                }
              >
                Restore{" "}
                {locations.find((row) => row.id === id)?.name ??
                  (id === "unassigned" ? "Unassigned" : id)}
              </button>
            ))}
            {(scope.excludedSections ?? []).map((row, index) => (
              <button
                type="button"
                className={filterButtonClass}
                key={JSON.stringify(row)}
                disabled={disabled}
                onClick={() =>
                  applyScope({
                    ...scope,
                    excludedSections: scope.excludedSections?.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                Restore{" "}
                {locations.find((value) => value.id === row.locationId)?.name ??
                  row.locationId}{" "}
                / {row.section}
              </button>
            ))}
            {(scope.excludedItems ?? []).map((id, index) => (
              <button
                type="button"
                key={id}
                className={filterButtonClass}
                disabled={disabled}
                onClick={() =>
                  applyScope({
                    ...scope,
                    excludedItems: scope.excludedItems?.filter(
                      (value) => value !== id,
                    ),
                  })
                }
              >
                Restore {seen[id] ?? `skipped stack ${index + 1}`}
              </button>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {server?.total ?? filtered.length} matching pulls ·{" "}
            {server?.pulled ?? rows.reduce((n, row) => n + row.pulled, 0)}{" "}
            copies marked pulled
          </span>
          <button
            type="button"
            className={filterButtonClass}
            disabled={disabled}
            onClick={() =>
              onSelection({
                ...selection,
                ...Object.fromEntries(
                  visible.map((row) => [row.id, row.quantity]),
                ),
              })
            }
          >
            Select this page
          </button>
          <button
            type="button"
            className={filterButtonClass}
            disabled={disabled}
            onClick={() => onSelection({})}
          >
            Clear selection
          </button>
        </div>
        <div
          className={
            layout === "boxes"
              ? "grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"
              : "min-w-0"
          }
        >
          {layout === "boxes" && (
            <nav
              aria-label="Hunt locations"
              className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch"
            >
              <button
                type="button"
                className={filterButtonClass}
                aria-pressed={!box}
                onClick={() => {
                  setBox("");
                  setPage(1);
                }}
              >
                All locations
              </button>
              {boxes.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  aria-pressed={box === row.id}
                  className={cn(filterButtonClass, "text-left")}
                  onClick={() => {
                    setBox(row.id);
                    setPage(1);
                  }}
                >
                  {row.name}
                </button>
              ))}
            </nav>
          )}
          <div className="min-w-0">
            {view === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Select",
                        "Card / printing",
                        bulk ? "Excess / keep" : "Pull",
                        "Box / section",
                        "For",
                        "Actions",
                      ].map((label) => (
                        <th
                          key={label}
                          className="border-b border-[var(--app-border)] p-2 text-[var(--app-accent)]"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--app-border)] align-top"
                      >
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name}, ${row.printing}, ${row.finish}, ${row.location}`}
                            disabled={disabled}
                            checked={(selection[row.id] ?? 0) > 0}
                            onChange={(event) =>
                              select(
                                row,
                                event.target.checked ? row.quantity : 0,
                              )
                            }
                          />
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="text-left underline"
                            onClick={() => setDetail(row.card)}
                          >
                            {row.name}
                          </button>
                          <p className="mt-1 text-xs text-[var(--app-muted)]">
                            {row.printing} · {row.finish} · {row.language} ·{" "}
                            {row.condition}
                          </p>
                        </td>
                        <td className="p-2">
                          {quantity(row)}
                          <p className="mt-1 text-xs">
                            {bulk
                              ? `${row.owned ?? 0} in storage · keep ${row.keep ?? 0} · `
                              : ""}
                            up to {row.quantity}
                            {row.pulled > 0 ? ` · ${row.pulled} pulled` : ""}
                          </p>
                        </td>
                        <td className="p-2">
                          {row.location}
                          {row.section ? ` / ${row.section}` : ""}
                        </td>
                        <td className="p-2">
                          {row.destination || "This hunt"}
                        </td>
                        <td className="p-2">{controls(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`grid gap-3 ${collectionCardGridClass(size)}`}>
                {visible.map((row) => (
                  <article
                    key={row.id}
                    className="min-w-0 rounded border-2 border-[var(--app-border)] bg-[var(--app-surface)] p-2"
                  >
                    <label className="mb-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={(selection[row.id] ?? 0) > 0}
                        onChange={(event) =>
                          select(row, event.target.checked ? row.quantity : 0)
                        }
                      />
                      {row.pulled
                        ? `${row.pulled} pulled`
                        : bulk
                          ? `${row.quantity} excess`
                          : `Pull ${row.quantity}`}
                    </label>
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => setDetail(row.card)}
                    >
                      {getInventoryCardImagePair(row.card).front ? (
                        <img
                          src={getInventoryCardImagePair(row.card).front}
                          alt={row.name}
                          loading="lazy"
                          width={265}
                          height={370}
                          className="aspect-[63/88] w-full rounded object-cover"
                        />
                      ) : (
                        <div className="flex aspect-[63/88] w-full items-center justify-center rounded border border-[var(--app-border)] p-2 text-sm">
                          {row.name}
                        </div>
                      )}
                      <p className="mt-2 truncate text-sm font-medium">
                        {row.name}
                      </p>
                    </button>
                    <p className="my-1 text-xs text-[var(--app-muted)]">
                      {row.printing} · {row.finish} · {row.language}
                    </p>
                    <p className="my-1 text-sm">
                      {row.location}
                      {row.section ? ` / ${row.section}` : ""}
                    </p>
                    <p className="mb-2 text-xs">{row.destination}</p>
                    {quantity(row)}
                    <div className="mt-2">{controls(row)}</div>
                  </article>
                ))}
              </div>
            )}
            {!visible.length && (
              <p className="p-4 text-sm text-[var(--app-muted)]">
                No pulls match these filters.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className={filterButtonClass}
            disabled={current <= 1}
            onClick={() =>
              server ? server.onPage(current - 1) : setPage(current - 1)
            }
          >
            Previous page
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button
            type="button"
            className={filterButtonClass}
            disabled={current >= pages}
            onClick={() =>
              server ? server.onPage(current + 1) : setPage(current + 1)
            }
          >
            Next page
          </button>
        </div>
        {children}
      </div>
      {detail && (
        <InventoryCardDetails row={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
