"use client";

import { useState } from "react";
import { cn, filterButtonClass, filterInputClass } from "../filterStyles";
import { ListPagination } from "../ListPagination";
import { filterNamedRows, pageList } from "@/lib/list-browse";

function useNamedList<T extends { name: string }>(rows: T[]) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const matching = filterNamedRows(rows, query);
  return {
    query,
    updateQuery: (next: string) => {
      setQuery(next);
      setPage(1);
    },
    page: pageList(matching, page, size),
    onPage: setPage,
    onSize: (next: number) => {
      setSize(next);
      setPage(1);
    },
  };
}

function NamedListControls({
  label,
  browse,
}: {
  label: string;
  browse: ReturnType<typeof useNamedList>;
}) {
  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex min-w-0 flex-wrap items-end gap-2"
      >
        <label className="min-w-0 flex-1 text-sm">
          Search {label.toLowerCase()}
          <input
            type="search"
            value={browse.query}
            maxLength={200}
            onChange={(event) => browse.updateQuery(event.target.value)}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Name…"
          />
        </label>
        {browse.query ? (
          <button
            type="button"
            className={filterButtonClass}
            onClick={() => browse.updateQuery("")}
          >
            Clear search
          </button>
        ) : null}
      </form>
      <ListPagination
        label={label}
        page={browse.page}
        onPage={browse.onPage}
        onSize={browse.onSize}
      />
    </div>
  );
}

export function UsageList({
  rows,
  empty,
  label,
}: {
  rows: Array<{
    key: string;
    name: string;
    appearances: number;
    copies: number;
  }>;
  empty: string;
  label: string;
}) {
  const browse = useNamedList(rows);
  // Keep the full-scope scale while narrowing the displayed rows.
  const max = rows.reduce((value, row) => Math.max(value, row.appearances), 0);
  return (
    <div className="mt-4 space-y-3" role="region" aria-label={label}>
      <NamedListControls label={label} browse={browse} />
      <div className="max-h-96 space-y-3 overflow-auto">
        {browse.page.items.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex flex-wrap items-end justify-between gap-3 text-sm">
              <span className="font-medium">{row.name}</span>
              <span className="app-muted whitespace-nowrap">
                {row.appearances} {row.appearances === 1 ? "deck" : "decks"} ·{" "}
                {row.copies} {row.copies === 1 ? "copy" : "copies"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-cyan-500"
                style={{
                  width: `${max ? Math.max(3, (row.appearances / max) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
        {!browse.page.items.length ? (
          <p className="app-muted text-sm">
            {rows.length
              ? "No matching entries. Clear the search to show more."
              : empty}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WinRateTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{
    key?: string;
    name: string;
    appearances: number;
    wins: number;
    winRate: number;
  }>;
}) {
  const browse = useNamedList(rows);
  return (
    <section className="app-panel min-w-0 overflow-hidden" aria-label={title}>
      <div className="space-y-3 border-b border-zinc-800 p-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="app-muted text-sm">{description}</p>
        <NamedListControls label={title} browse={browse} />
      </div>
      <div className="max-h-[32rem] overflow-auto" tabIndex={0}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-right">Used</th>
              <th className="p-3 text-right">Wins</th>
              <th className="p-3 text-right">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {browse.page.items.map((row) => (
              <tr
                key={row.key ?? row.name}
                className="border-t border-zinc-800"
              >
                <td className="p-3 font-medium">{row.name}</td>
                <td className="p-3 text-right">{row.appearances}</td>
                <td className="p-3 text-right">{row.wins}</td>
                <td className="p-3 text-right font-semibold">
                  {Math.round(row.winRate * 100)}%
                </td>
              </tr>
            ))}
            {!browse.page.items.length ? (
              <tr>
                <td colSpan={4} className="app-muted p-5 text-center">
                  {rows.length
                    ? "No matching entries. Clear the search to show more."
                    : "No match deck data is available yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
