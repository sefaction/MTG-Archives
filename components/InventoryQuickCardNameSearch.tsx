"use client";

import type { FormEvent } from "react";
import { useId } from "react";
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
};

const OMITTED_PARAMS = new Set(["cardName", "page"]);

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
}: InventoryQuickCardNameSearchProps) {
  const inputId = useId();
  const entries = paramEntries(params);
  const cardName = first(params, "cardName");
  const clearParams = new URLSearchParams();
  entries.forEach(([key, value]) => clearParams.append(key, value));
  clearParams.set("page", "1");
  const clearHref = `${actionPath}?${clearParams.toString()}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
      if (key === "cardName" || key === "page") continue;
      const stringValue = String(value);
      if (stringValue) next.append(key, stringValue);
    }

    const nextCardName = String(formData.get("cardName") || "").trim();
    if (nextCardName) next.set("cardName", nextCardName);
    next.set("page", "1");

    const query = next.toString();
    window.location.assign(query ? `${actionPath}?${query}` : actionPath);
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
        {entries.map(([key, value], index) => (
          <input
            key={`${key}-${value}-${index}`}
            type="hidden"
            name={key}
            value={value}
          />
        ))}
        <label
          className="block flex-1 text-xs font-medium text-zinc-300"
          htmlFor={inputId}
        >
          Quick card name search
          <input
            id={inputId}
            name="cardName"
            defaultValue={cardName}
            placeholder="Search card name…"
            className={cn(filterInputClass, "mt-1 w-full")}
          />
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
