"use client";

import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { ManaSymbol } from "./mtg/ManaSymbol";
import {
  cn,
  filterButtonClass,
  filterInlineFieldClass,
  filterInputClass,
  filterLabelClass,
  filterOptionClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "./filterStyles";

export type FilterOption = { value: string; label: string };
export type FilterLocationOption = FilterOption & { kind?: string };

export type InventoryAdvancedSearchCapabilities = {
  showOwnerScopeControls: boolean;
  showOwnerFilter: boolean;
  showVisibilityFilter: boolean;
  showSourceFilter: boolean;
  showInventoryScopeFilter: boolean;
  showLocationFilter: boolean;
};

type InventoryAdvancedSearchProps = {
  actionPath: string;
  params: Record<string, string | string[] | undefined>;
  displayMode: "exact" | "grouped";
  isAdmin?: boolean;
  isPublic?: boolean;
  capabilities?: Partial<InventoryAdvancedSearchCapabilities>;
  players?: FilterOption[];
  locations?: FilterLocationOption[];
  ownerParamName?: "ownerId" | "owner";
  ownerFilterLabel?: string;
  ownerAllLabel?: string;
  locationParamName?: "locationId" | "locationName";
  includeUnassignedLocationOption?: boolean;
  setOptions?: FilterOption[];
  cardNameOptions?: string[];
  suggestionsEndpoint?: string;
  clearHref: string;
};

type AutocompleteOption = {
  value: string;
  label: string;
  description?: string;
};
type FilterChipItem = {
  key: string;
  label: string;
  value: string;
  href: string;
};

const RARITY_OPTIONS = [
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
  { value: "mythic", label: "Mythic" },
  { value: "special", label: "Special" },
  { value: "bonus", label: "Bonus" },
];

const FINISH_OPTIONS = [
  { value: "nonfoil", label: "Nonfoil" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" },
];

const SOURCE_OPTIONS = [
  { value: "import", label: "Import" },
  { value: "manual", label: "Manual add" },
  { value: "trade", label: "Trade" },
  { value: "correction", label: "Correction" },
  { value: "legacy", label: "Legacy" },
  { value: "other", label: "Other" },
];

const COLOR_OPTIONS = [
  { value: "W", label: "White", symbol: "W" },
  { value: "U", label: "Blue", symbol: "U" },
  { value: "B", label: "Black", symbol: "B" },
  { value: "R", label: "Red", symbol: "R" },
  { value: "G", label: "Green", symbol: "G" },
  { value: "C", label: "Colorless", symbol: "C" },
];

const COLOR_MODE_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "include", label: "All" },
  { value: "exact", label: "Exact" },
  { value: "atMost", label: "At most" },
  { value: "atLeast", label: "At least" },
];

const INVENTORY_SCROLL_STORAGE_KEY = "mtg-inventory-scroll-y";
const ADVANCED_SEARCH_PANEL_STORAGE_KEY = "mtg-inventory-advanced-search-open";

function values(params: InventoryAdvancedSearchProps["params"], key: string) {
  const value = params[key];
  if (Array.isArray(value)) return value.flatMap((entry) => entry.split(","));
  return value ? String(value).split(",") : [];
}

function first(params: InventoryAdvancedSearchProps["params"], key: string) {
  return values(params, key)[0] || "";
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function optionLabel(options: FilterOption[], value: string) {
  return options.find((option) => option.value === value)?.label || value;
}

function paramsToUrlSearchParams(
  params: InventoryAdvancedSearchProps["params"],
) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => next.append(key, entry));
      return;
    }
    if (value !== undefined) next.set(key, value);
  });
  return next;
}

function hrefWithParams(actionPath: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${actionPath}?${query}` : actionPath;
}

function removeOneParamValue(
  params: InventoryAdvancedSearchProps["params"],
  actionPath: string,
  key: string,
  valueToRemove?: string,
  extraKeysWhenEmpty: string[] = [],
) {
  const next = paramsToUrlSearchParams(params);
  const remaining = values(params, key).filter(
    (value) =>
      valueToRemove === undefined ||
      value.toLowerCase() !== valueToRemove.toLowerCase(),
  );
  next.delete(key);
  remaining.forEach((value) => next.append(key, value));
  if (!remaining.length)
    extraKeysWhenEmpty.forEach((keyName) => next.delete(keyName));
  next.delete("page");
  return hrefWithParams(actionPath, next);
}

function removeWholeParam(
  params: InventoryAdvancedSearchProps["params"],
  actionPath: string,
  key: string,
  extraKeys: string[] = [],
) {
  const next = paramsToUrlSearchParams(params);
  next.delete(key);
  extraKeys.forEach((keyName) => next.delete(keyName));
  next.delete("page");
  return hrefWithParams(actionPath, next);
}

function filterSuggestions(
  options: AutocompleteOption[],
  input: string,
  selected: string[] = [],
  limit = 8,
) {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const selectedSet = new Set(selected.map((value) => value.toLowerCase()));
  return options
    .filter((option) => {
      const haystack =
        `${option.value} ${option.label} ${option.description || ""}`.toLowerCase();
      return (
        haystack.includes(needle) &&
        !selectedSet.has(option.value.toLowerCase())
      );
    })
    .slice(0, limit);
}

function useAutocompleteSuggestions({
  endpoint,
  kind,
  input,
  staticOptions,
  selected = [],
  limit = 30,
}: {
  endpoint?: string;
  kind: "cardName" | "typeLine" | "set";
  input: string;
  staticOptions: AutocompleteOption[];
  selected?: string[];
  limit?: number;
}) {
  const [remoteOptions, setRemoteOptions] = useState<AutocompleteOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const query = input.trim();

  useEffect(() => {
    if (!endpoint || query.length < 1) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(endpoint, window.location.origin);
        const current = new URLSearchParams(window.location.search);
        current.forEach((value, key) => {
          if (!url.searchParams.has(key)) url.searchParams.append(key, value);
        });
        url.searchParams.set("kind", kind);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", String(limit));
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestion request failed");
        const payload = (await response.json()) as {
          suggestions?: AutocompleteOption[];
          hasMore?: boolean;
        };
        setRemoteOptions(payload.suggestions || []);
        setHasMore(Boolean(payload.hasMore));
      } catch (error) {
        if (!controller.signal.aborted) {
          setRemoteOptions([]);
          setHasMore(false);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [endpoint, kind, limit, query]);

  const options = endpoint
    ? query.length < 1
      ? []
      : remoteOptions
    : filterSuggestions(staticOptions, input, selected, limit);
  return {
    options,
    hasMore: endpoint && query.length < 1 ? false : hasMore,
    loading: endpoint && query.length < 1 ? false : loading,
  };
}

function AutocompleteSuggestionList({
  id,
  options,
  highlighted,
  onChoose,
  hasMore = false,
  loading = false,
}: {
  id: string;
  options: AutocompleteOption[];
  highlighted: number;
  onChoose: (option: AutocompleteOption) => void;
  hasMore?: boolean;
  loading?: boolean;
}) {
  if (!options.length && !hasMore && !loading) return null;
  return (
    <div
      id={id}
      role="listbox"
      className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-700 bg-zinc-950 p-1 text-sm shadow-xl shadow-black/30"
    >
      {options.map((option, index) => (
        <button
          key={`${option.value}-${option.label}`}
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
            onChoose(option);
          }}
        >
          <span className="block font-medium">{option.label}</span>
          {option.description ? (
            <span className="block text-xs text-zinc-400">
              {option.description}
            </span>
          ) : null}
        </button>
      ))}
      {loading ? (
        <div className="px-2 py-1.5 text-xs text-zinc-400">
          Loading suggestions…
        </div>
      ) : null}
      {hasMore ? (
        <div className="px-2 py-1.5 text-xs text-zinc-400">
          More matches available, keep typing…
        </div>
      ) : null}
    </div>
  );
}

function AutocompleteInput({
  label,
  name,
  initialValue,
  placeholder,
  options,
  suggestionsEndpoint,
  suggestionKind,
}: {
  label: string;
  name: string;
  initialValue: string;
  placeholder: string;
  options: AutocompleteOption[];
  suggestionsEndpoint?: string;
  suggestionKind: "cardName" | "typeLine" | "set";
}) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const {
    options: suggestions,
    hasMore,
    loading,
  } = useAutocompleteSuggestions({
    endpoint: suggestionsEndpoint,
    kind: suggestionKind,
    input: value,
    staticOptions: options,
    limit: 30,
  });

  function choose(option: AutocompleteOption) {
    setValue(option.value);
    setOpen(false);
    setHighlighted(0);
  }

  function chooseAndSubmit(
    option: AutocompleteOption,
    form: HTMLFormElement | null,
  ) {
    choose(option);
    window.setTimeout(() => form?.requestSubmit(), 0);
  }

  return (
    <div className="relative">
      <label className={filterLabelClass} htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setHighlighted((current) => (current + 1) % suggestions.length);
          }
          if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setHighlighted(
              (current) =>
                (current - 1 + suggestions.length) % suggestions.length,
            );
          }
          if (event.key === "Enter" && open && suggestions[highlighted]) {
            event.preventDefault();
            chooseAndSubmit(suggestions[highlighted], event.currentTarget.form);
          }
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={open && suggestions.length ? listId : undefined}
        aria-expanded={open && suggestions.length ? "true" : "false"}
        className={cn(filterInputClass, "mt-1 w-full")}
      />
      {open ? (
        <AutocompleteSuggestionList
          id={listId}
          options={suggestions}
          highlighted={highlighted}
          onChoose={choose}
          hasMore={hasMore}
          loading={loading}
        />
      ) : null}
    </div>
  );
}

function TokenAutocompleteInput({
  label,
  name,
  initialTokens,
  placeholder,
  options,
  normalizeToken = titleCase,
  tokenLabel,
  suggestionsEndpoint,
  suggestionKind,
}: {
  label: string;
  name: string;
  initialTokens: string[];
  placeholder: string;
  options: AutocompleteOption[];
  normalizeToken?: (value: string) => string;
  tokenLabel?: (value: string) => string;
  suggestionsEndpoint?: string;
  suggestionKind: "cardName" | "typeLine" | "set";
}) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const [tokens, setTokens] = useState<string[]>(
    initialTokens.map(normalizeToken),
  );
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const {
    options: suggestions,
    hasMore,
    loading,
  } = useAutocompleteSuggestions({
    endpoint: suggestionsEndpoint,
    kind: suggestionKind,
    input,
    staticOptions: options,
    selected: tokens,
    limit: 30,
  });

  function addToken(value: string) {
    const token = normalizeToken(value);
    if (!token) return;
    setTokens((current) =>
      current.some((entry) => entry.toLowerCase() === token.toLowerCase())
        ? current
        : [...current, token],
    );
    setInput("");
    setOpen(false);
    setHighlighted(0);
  }

  function choose(option: AutocompleteOption) {
    addToken(option.value);
  }

  function addTokenAndSubmit(value: string, form: HTMLFormElement | null) {
    addToken(value);
    window.setTimeout(() => form?.requestSubmit(), 0);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={tokens.join(",")} />
      <label className={filterLabelClass} htmlFor={inputId}>
        {label}
      </label>
      <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 transition-colors focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30">
        {tokens.map((token) => (
          <FilterChip
            key={token}
            label={label === "Type line" ? "Type" : label}
            value={tokenLabel?.(token) || token}
            onRemove={() =>
              setTokens((current) => current.filter((entry) => entry !== token))
            }
          />
        ))}
        <input
          id={inputId}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setHighlighted((current) => (current + 1) % suggestions.length);
            }
            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setHighlighted(
                (current) =>
                  (current - 1 + suggestions.length) % suggestions.length,
              );
            }
            if (event.key === "Enter" && input.trim()) {
              event.preventDefault();
              addTokenAndSubmit(
                suggestions[highlighted]?.value || input,
                event.currentTarget.form,
              );
            }
            if (event.key === "Escape") {
              setOpen(false);
            }
            if (event.key === "Backspace" && !input && tokens.length) {
              setTokens((current) => current.slice(0, -1));
            }
          }}
          onBlur={() => setOpen(false)}
          placeholder={tokens.length ? "Add another…" : placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={open && suggestions.length ? listId : undefined}
          aria-expanded={open && suggestions.length ? "true" : "false"}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>
      {open ? (
        <AutocompleteSuggestionList
          id={listId}
          options={suggestions}
          highlighted={highlighted}
          onChoose={choose}
          hasMore={hasMore}
          loading={loading}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  value,
  href,
  onRemove,
}: {
  label: string;
  value: string;
  href?: string;
  onRemove?: () => void;
}) {
  const content = (
    <>
      <span className="font-medium">{label}:</span> {value}
      <span aria-hidden="true" className="ml-1 text-sky-300">
        ×
      </span>
    </>
  );
  const className =
    "inline-flex items-center gap-1 rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-100 hover:bg-sky-900";

  if (href) {
    return (
      <a
        href={href}
        className={className}
        aria-label={`Remove ${label}: ${value}`}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onRemove}
      aria-label={`Remove ${label}: ${value}`}
    >
      {content}
    </button>
  );
}

function FilterChipBar({ chips }: { chips: FilterChipItem[] }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1" aria-label="Active filters">
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          label={chip.label}
          value={chip.value}
          href={chip.href}
        />
      ))}
    </div>
  );
}

function MultiSelectDropdown({
  label,
  name,
  options,
  selected,
  compact = false,
}: {
  label: string;
  name: string;
  options: FilterOption[];
  selected: string[];
  compact?: boolean;
}) {
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);
  return (
    <details className={cn(filterInlineFieldClass, "relative min-w-44")}>
      <summary className="cursor-pointer list-none">
        <span className="text-zinc-400">{label}: </span>
        <span className="text-zinc-100">
          {selectedLabels.length
            ? compact && selectedLabels.length > 2
              ? `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`
              : selectedLabels.join(", ")
            : "Any"}
        </span>
      </summary>
      <div className="absolute z-30 mt-2 max-h-64 min-w-56 overflow-auto rounded-md border border-zinc-700 bg-zinc-950 p-2 shadow-xl shadow-black/30">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800"
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  );
}

function ColorIdentityControls({
  selected,
  mode,
}: {
  selected: string[];
  mode: string;
}) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 transition-colors focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30">
      <span className={filterLabelClass}>Color ID</span>
      <select
        name="colorIdentityMode"
        defaultValue={mode || "include"}
        className={filterSelectClass}
        title="Any = one selected color; All = every selected color; Exact = no extras; At most = subset; At least = superset."
      >
        {COLOR_MODE_OPTIONS.map((option) => (
          <option
            className={filterOptionClass}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1" aria-label="Color identity">
        {COLOR_OPTIONS.map((color) => (
          <label
            key={color.value}
            className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border ${selected.includes(color.value) ? "border-sky-400 bg-sky-950" : "border-zinc-700 bg-zinc-900"}`}
            title={color.label}
          >
            <input
              type="checkbox"
              name="colorIdentity"
              value={color.value}
              defaultChecked={selected.includes(color.value)}
              aria-label={`Color identity ${color.label}`}
              className="sr-only"
            />
            <ManaSymbol token={color.symbol} ariaHidden />
            <span className="sr-only">{color.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function buildActiveChips({
  params,
  actionPath,
  rarity,
  finish,
  source,
  ownerParamName,
  ownerFilterLabel,
  locationValues,
  locationParamName,
  locationOptions,
  typeTokens,
  colorIdentity,
  capabilities,
}: {
  params: InventoryAdvancedSearchProps["params"];
  actionPath: string;
  rarity: string[];
  finish: string[];
  source: string[];
  ownerParamName: "ownerId" | "owner";
  ownerFilterLabel: string;
  locationValues: string[];
  locationParamName: "locationId" | "locationName";
  locationOptions: FilterOption[];
  typeTokens: string[];
  colorIdentity: string[];
  capabilities: InventoryAdvancedSearchCapabilities;
}) {
  const chips: FilterChipItem[] = [];
  const pushWhole = (
    key: string,
    label: string,
    value?: string,
    extraKeys: string[] = [],
  ) => {
    if (!value) return;
    chips.push({
      key: `${key}-${value}`,
      label,
      value,
      href: removeWholeParam(params, actionPath, key, extraKeys),
    });
  };
  const pushOne = (
    key: string,
    label: string,
    value: string,
    displayValue = value,
    extraKeysWhenEmpty: string[] = [],
  ) => {
    if (!value) return;
    chips.push({
      key: `${key}-${value}`,
      label,
      value: displayValue,
      href: removeOneParamValue(
        params,
        actionPath,
        key,
        value,
        extraKeysWhenEmpty,
      ),
    });
  };

  pushWhole("cardName", "Name", first(params, "cardName"));
  pushWhole("oracleText", "Oracle", first(params, "oracleText"));
  typeTokens.forEach((token) =>
    pushOne(
      values(params, "typeTokens").length ? "typeTokens" : "type",
      "Type",
      token,
      titleCase(token),
    ),
  );
  values(params, "set").forEach((set) =>
    pushOne("set", "Set", set, set.toUpperCase()),
  );
  rarity.forEach((value) =>
    pushOne("rarity", "Rarity", value, titleCase(value)),
  );
  finish.forEach((value) =>
    pushOne(
      values(params, "finish").length ? "finish" : "foil",
      "Finish",
      value,
      titleCase(value),
    ),
  );
  values(params, "language").forEach((value) =>
    pushOne("language", "Language", value, value.toUpperCase()),
  );
  if (capabilities.showSourceFilter) {
    source.forEach((value) =>
      pushOne("source", "Source", value, optionLabel(SOURCE_OPTIONS, value)),
    );
  }
  if (capabilities.showLocationFilter) {
    locationValues.forEach((value) =>
      pushOne(
        value === "unassigned" && !values(params, locationParamName).length
          ? "hasLocation"
          : locationParamName,
        "Location",
        value,
        optionLabel(locationOptions, value),
      ),
    );
  }
  if (capabilities.showVisibilityFilter)
    pushWhole("visibility", "Visibility", first(params, "visibility"));
  if (capabilities.showOwnerFilter || capabilities.showOwnerScopeControls) {
    pushWhole(ownerParamName, ownerFilterLabel, first(params, ownerParamName));
  }
  if (capabilities.showInventoryScopeFilter)
    pushWhole("commitment", "Inventory", first(params, "commitment"));
  colorIdentity.forEach((value) => {
    const mode =
      COLOR_MODE_OPTIONS.find(
        (option) => option.value === first(params, "colorIdentityMode"),
      )?.label || "All";
    pushOne(
      "colorIdentity",
      "Color Identity",
      value,
      `${mode} ${optionLabel(COLOR_OPTIONS, value)}`,
      ["colorIdentityMode"],
    );
  });
  const mvOp = first(params, "mvOp");
  if (mvOp === "between") {
    const min = first(params, "mvMin") || first(params, "manaValueMin");
    const max = first(params, "mvMax") || first(params, "manaValueMax");
    pushWhole("mvOp", "Mana Value", `${min || "…"}–${max || "…"}`, [
      "mv",
      "mvMin",
      "mvMax",
      "manaValueMin",
      "manaValueMax",
    ]);
  } else if (mvOp && first(params, "mv")) {
    const opLabel =
      { eq: "=", lt: "<", lte: "<=", gt: ">", gte: ">=" }[mvOp] || mvOp;
    pushWhole("mvOp", "Mana Value", `${opLabel} ${first(params, "mv")}`, [
      "mv",
    ]);
  }
  pushWhole(
    "priceMin",
    "Price",
    first(params, "priceMin") ? `>= ${first(params, "priceMin")}` : "",
  );
  pushWhole(
    "priceMax",
    "Price",
    first(params, "priceMax") ? `<= ${first(params, "priceMax")}` : "",
  );
  return chips;
}

export function InventoryAdvancedSearch({
  actionPath,
  params,
  displayMode,
  isAdmin = false,
  isPublic = false,
  capabilities: capabilityOverrides,
  players = [],
  locations = [],
  ownerParamName = isPublic ? "owner" : "ownerId",
  ownerFilterLabel = isPublic ? "Current owner" : "Owner",
  ownerAllLabel = isPublic ? "All public owners" : "All owners",
  locationParamName = isPublic ? "locationName" : "locationId",
  includeUnassignedLocationOption = !isPublic,
  setOptions = [],
  cardNameOptions = [],
  suggestionsEndpoint = isPublic
    ? "/api/inventory/filter-suggestions?public=1"
    : "/api/inventory/filter-suggestions",
  clearHref,
}: InventoryAdvancedSearchProps) {
  const router = useRouter();
  const capabilities: InventoryAdvancedSearchCapabilities = {
    showOwnerScopeControls: isAdmin && !isPublic,
    showOwnerFilter: isPublic,
    showVisibilityFilter: !isPublic,
    showSourceFilter: !isPublic,
    showInventoryScopeFilter: !isPublic,
    showLocationFilter: true,
    ...capabilityOverrides,
  };
  const rarity = values(params, "rarity");
  const finish = values(params, "finish").length
    ? values(params, "finish")
    : first(params, "foil") === "true"
      ? ["foil"]
      : first(params, "foil") === "false"
        ? ["nonfoil"]
        : [];
  const source = values(params, "source");
  const selectedLocationValues =
    values(params, locationParamName).length ||
    first(params, "hasLocation") !== "unassigned"
      ? values(params, locationParamName)
      : ["unassigned"];
  const typeTokens = values(params, "typeTokens").length
    ? values(params, "typeTokens")
    : values(params, "type");
  const colorIdentity = values(params, "colorIdentity");
  const initialMvOp =
    first(params, "mvOp") ||
    (first(params, "manaValueMin") || first(params, "manaValueMax")
      ? "between"
      : "");
  const [mvOp, setMvOp] = useState(initialMvOp);
  const locationOptions = [
    ...(includeUnassignedLocationOption
      ? [{ value: "unassigned", label: "Unassigned" }]
      : []),
    ...locations.map((location) => ({
      value: location.value,
      label: `${location.kind === "DECK" ? "Deck: " : ""}${location.label}`,
    })),
  ];
  const cardOptions = cardNameOptions.map((name) => ({
    value: name,
    label: name,
  }));
  const setAutocompleteOptions = setOptions.map((set) => ({
    value: set.value,
    label: set.label,
    description: set.value.toUpperCase(),
  }));
  const typeOptions: AutocompleteOption[] = [];
  const activeChips = buildActiveChips({
    params,
    actionPath,
    rarity,
    finish,
    source,
    ownerParamName,
    ownerFilterLabel,
    locationValues: selectedLocationValues,
    locationParamName,
    locationOptions,
    typeTokens,
    colorIdentity,
    capabilities,
  });

  const activeFilterSummary = activeChips.length
    ? `${activeChips.length} ${activeChips.length === 1 ? "filter" : "filters"} active`
    : "Optional filters hidden";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    formData.forEach((value, key) => {
      const text = String(value).trim();
      if (!text) return;
      next.append(key, text);
    });
    next.set("page", "1");
    window.sessionStorage.setItem(
      INVENTORY_SCROLL_STORAGE_KEY,
      String(window.scrollY),
    );
    window.sessionStorage.setItem(ADVANCED_SEARCH_PANEL_STORAGE_KEY, "open");
    const query = next.toString();
    router.replace(query ? `${actionPath}?${query}` : actionPath, {
      scroll: false,
    });
  }

  return (
    <>
      {activeChips.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/80 p-2">
          <FilterChipBar chips={activeChips} />
          <a href={clearHref} className={filterButtonClass}>
            Clear Filters
          </a>
        </div>
      ) : null}
      <CollapsiblePanel
        title="Advanced Inventory Search"
        defaultOpen={false}
        summary={activeFilterSummary}
        storageKey={ADVANCED_SEARCH_PANEL_STORAGE_KEY}
      >
        <form className="space-y-3" action={actionPath} onSubmit={handleSubmit}>
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="displayMode" value={displayMode} />
          {first(params, "pageSize") ? (
            <input
              type="hidden"
              name="pageSize"
              value={first(params, "pageSize")}
            />
          ) : null}
          {first(params, "browse") ? (
            <input
              type="hidden"
              name="browse"
              value={first(params, "browse")}
            />
          ) : null}
          {first(params, "sort") ? (
            <input type="hidden" name="sort" value={first(params, "sort")} />
          ) : null}
          {first(params, "sortDir") ? (
            <input
              type="hidden"
              name="sortDir"
              value={first(params, "sortDir")}
            />
          ) : null}
          <section className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="mb-3 text-xs font-semibold uppercase text-zinc-500">
              Card text and printing
            </div>
            <div className="grid items-end gap-3 lg:grid-cols-[minmax(13rem,1.2fr)_minmax(16rem,1.4fr)_minmax(13rem,1fr)_minmax(13rem,1fr)]">
              <AutocompleteInput
                label="Card name"
                name="cardName"
                initialValue={first(params, "cardName")}
                placeholder="Sol Ring"
                options={cardOptions}
                suggestionsEndpoint={suggestionsEndpoint}
                suggestionKind="cardName"
              />
              <TokenAutocompleteInput
                label="Type line"
                name="typeTokens"
                initialTokens={typeTokens}
                placeholder="Legendary, Angel..."
                options={typeOptions}
                suggestionsEndpoint={suggestionsEndpoint}
                suggestionKind="typeLine"
              />
              <label className={filterLabelClass}>
                Oracle text
                <input
                  name="oracleText"
                  defaultValue={first(params, "oracleText")}
                  placeholder="draw a card"
                  className={cn(filterInputClass, "mt-1 w-full")}
                />
              </label>
              <TokenAutocompleteInput
                label="Set"
                name="set"
                initialTokens={values(params, "set")}
                placeholder="TLA or Avatar"
                options={setAutocompleteOptions}
                normalizeToken={(value) => value.trim().toLowerCase()}
                tokenLabel={(value) => value.toUpperCase()}
                suggestionsEndpoint={suggestionsEndpoint}
                suggestionKind="set"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MultiSelectDropdown
                label="Rarity"
                name="rarity"
                options={RARITY_OPTIONS}
                selected={rarity}
                compact
              />
              <MultiSelectDropdown
                label="Finish"
                name="finish"
                options={FINISH_OPTIONS}
                selected={finish}
              />
            </div>
          </section>

          <section className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="mb-3 text-xs font-semibold uppercase text-zinc-500">
              Color and mana
            </div>
            <div className="flex flex-wrap gap-2">
              <ColorIdentityControls
                selected={colorIdentity}
                mode={first(params, "colorIdentityMode")}
              />
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 transition-colors focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30">
                <span className={filterLabelClass}>Mana value</span>
                <select
                  name="mvOp"
                  value={mvOp}
                  onChange={(event) => setMvOp(event.target.value)}
                  className={filterSelectClass}
                >
                  <option className={filterOptionClass} value="">
                    Any
                  </option>
                  <option className={filterOptionClass} value="eq">
                    =
                  </option>
                  <option className={filterOptionClass} value="lt">
                    &lt;
                  </option>
                  <option className={filterOptionClass} value="lte">
                    &lt;=
                  </option>
                  <option className={filterOptionClass} value="gt">
                    &gt;
                  </option>
                  <option className={filterOptionClass} value="gte">
                    &gt;=
                  </option>
                  <option className={filterOptionClass} value="between">
                    Between
                  </option>
                </select>
                {mvOp && mvOp !== "between" ? (
                  <input
                    name="mv"
                    type="number"
                    step="0.5"
                    defaultValue={first(params, "mv")}
                    placeholder="Value"
                    className={cn(filterInputClass, "w-20")}
                  />
                ) : null}
                {mvOp === "between" ? (
                  <>
                    <input
                      name="mvMin"
                      type="number"
                      step="0.5"
                      defaultValue={
                        first(params, "mvMin") || first(params, "manaValueMin")
                      }
                      placeholder="Min"
                      className={cn(filterInputClass, "w-20")}
                    />
                    <input
                      name="mvMax"
                      type="number"
                      step="0.5"
                      defaultValue={
                        first(params, "mvMax") || first(params, "manaValueMax")
                      }
                      placeholder="Max"
                      className={cn(filterInputClass, "w-20")}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="mb-3 text-xs font-semibold uppercase text-zinc-500">
              Collection fields
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={cn(filterInlineFieldClass, "min-w-32")}>
                <span className="text-zinc-400">Language</span>
                <input
                  name="language"
                  defaultValue={values(params, "language").join(",")}
                  placeholder="Any"
                  className="ml-2 w-20 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-500"
                />
              </label>
              {capabilities.showLocationFilter ? (
                <MultiSelectDropdown
                  label="Location"
                  name={locationParamName}
                  options={locationOptions}
                  selected={selectedLocationValues}
                  compact
                />
              ) : null}
              {capabilities.showVisibilityFilter ? (
                <label className={cn(filterInlineFieldClass, "min-w-44")}>
                  <span className="text-zinc-400">Visibility: </span>
                  <select
                    name="visibility"
                    defaultValue={first(params, "visibility")}
                    className={cn(filterSelectClass, "min-w-32")}
                  >
                    <option className={filterOptionClass} value="">
                      Any
                    </option>
                    <option className={filterOptionClass} value="public">
                      Public
                    </option>
                    <option className={filterOptionClass} value="private">
                      Private
                    </option>
                    <option className={filterOptionClass} value="inherit">
                      Default
                    </option>
                    <option
                      className={filterOptionClass}
                      value="explicitPublic"
                    >
                      Explicit public
                    </option>
                    <option
                      className={filterOptionClass}
                      value="explicitPrivate"
                    >
                      Explicit private
                    </option>
                  </select>
                </label>
              ) : null}
              {capabilities.showSourceFilter ? (
                <MultiSelectDropdown
                  label="Source"
                  name="source"
                  options={SOURCE_OPTIONS}
                  selected={source}
                  compact
                />
              ) : null}
              {capabilities.showOwnerFilter ||
              capabilities.showOwnerScopeControls ? (
                <label className={cn(filterInlineFieldClass, "min-w-48")}>
                  <span className="text-zinc-400">{ownerFilterLabel}: </span>
                  <select
                    name={ownerParamName}
                    defaultValue={first(params, ownerParamName)}
                    className={cn(filterSelectClass, "min-w-32")}
                  >
                    <option className={filterOptionClass} value="">
                      {ownerAllLabel}
                    </option>
                    {players.map((player) => (
                      <option
                        className={filterOptionClass}
                        key={player.value}
                        value={player.value}
                      >
                        {player.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {capabilities.showInventoryScopeFilter ? (
                <label className={cn(filterInlineFieldClass, "min-w-44")}>
                  <span className="text-zinc-400">Inventory: </span>
                  <select
                    name="commitment"
                    defaultValue={first(params, "commitment")}
                    className={cn(filterSelectClass, "min-w-32")}
                  >
                    <option className={filterOptionClass} value="">
                      All
                    </option>
                    <option className={filterOptionClass} value="available">
                      Available
                    </option>
                    <option className={filterOptionClass} value="committed">
                      Committed
                    </option>
                  </select>
                </label>
              ) : null}
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 transition-colors focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30">
                <span className={filterLabelClass}>USD</span>
                <input
                  name="priceMin"
                  type="number"
                  step="0.01"
                  defaultValue={first(params, "priceMin")}
                  placeholder="Min"
                  className={cn(filterInputClass, "w-24")}
                />
                <input
                  name="priceMax"
                  type="number"
                  step="0.01"
                  defaultValue={first(params, "priceMax")}
                  placeholder="Max"
                  className={cn(filterInputClass, "w-24")}
                />
              </div>
            </div>
          </section>
          <FilterChipBar chips={activeChips} />

          <div className="flex flex-wrap gap-2">
            <button className={filterPrimaryButtonClass}>Apply filters</button>
            <a href={clearHref} className={filterButtonClass}>
              Clear Filters
            </a>
          </div>
        </form>
      </CollapsiblePanel>
    </>
  );
}
