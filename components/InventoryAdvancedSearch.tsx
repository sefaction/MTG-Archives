"use client";

import { useMemo, useState } from "react";
import { ManaSymbol } from "./mtg/ManaSymbol";

export type FilterOption = { value: string; label: string };
export type FilterLocationOption = FilterOption & { kind?: string };

type InventoryAdvancedSearchProps = {
  actionPath: string;
  params: Record<string, string | string[] | undefined>;
  displayMode: "exact" | "grouped";
  isAdmin?: boolean;
  isPublic?: boolean;
  players?: FilterOption[];
  locations?: FilterLocationOption[];
  setOptions?: FilterOption[];
  cardNameOptions?: string[];
  clearHref: string;
};

const TYPE_SUGGESTIONS = [
  "Basic",
  "Legendary",
  "Snow",
  "World",
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Aura",
  "Equipment",
  "Vehicle",
  "Saga",
  "Food",
  "Treasure",
  "Clue",
  "Blood",
  "Angel",
  "Dragon",
  "Human",
  "Elf",
  "Goblin",
  "Zombie",
  "Vampire",
  "Wizard",
  "Warrior",
  "Soldier",
  "Spirit",
  "Beast",
  "Elemental",
];

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
    <details className="relative min-w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm">
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
      <div className="absolute z-30 mt-2 max-h-64 min-w-56 overflow-auto rounded border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
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

function TypeTokenInput({ initialTokens }: { initialTokens: string[] }) {
  const [tokens, setTokens] = useState<string[]>(initialTokens.map(titleCase));
  const [input, setInput] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const suggestions = useMemo(() => {
    const needle = input.trim().toLowerCase();
    if (!needle) return [];
    return TYPE_SUGGESTIONS.filter(
      (suggestion) =>
        suggestion.toLowerCase().includes(needle) &&
        !tokens.some(
          (token) => token.toLowerCase() === suggestion.toLowerCase(),
        ),
    ).slice(0, 6);
  }, [input, tokens]);

  function addToken(value: string) {
    const token = titleCase(value);
    if (!token) return;
    setTokens((current) =>
      current.some((entry) => entry.toLowerCase() === token.toLowerCase())
        ? current
        : [...current, token],
    );
    setInput("");
    setHighlighted(0);
  }

  return (
    <div className="relative">
      <input type="hidden" name="typeTokens" value={tokens.join(",")} />
      <label
        className="text-xs font-medium text-zinc-300"
        htmlFor="type-token-input"
      >
        Type tokens
      </label>
      <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
        {tokens.map((token) => (
          <span
            key={token}
            className="inline-flex items-center gap-1 rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-100"
          >
            {token}
            <button
              type="button"
              aria-label={`Remove ${token} type filter`}
              className="text-sky-300 hover:text-white"
              onClick={() =>
                setTokens((current) =>
                  current.filter((entry) => entry !== token),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="type-token-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setHighlighted((current) => (current + 1) % suggestions.length);
            }
            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setHighlighted(
                (current) =>
                  (current - 1 + suggestions.length) % suggestions.length,
              );
            }
            if (event.key === "Enter" && input.trim()) {
              event.preventDefault();
              addToken(suggestions[highlighted] || input);
            }
            if (event.key === "Backspace" && !input && tokens.length) {
              setTokens((current) => current.slice(0, -1));
            }
          }}
          placeholder={tokens.length ? "Add another…" : "Legendary, Angel…"}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      {suggestions.length ? (
        <div className="absolute z-40 mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-1 text-sm shadow-xl">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className={`block w-full rounded px-2 py-1 text-left ${index === highlighted ? "bg-zinc-800" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                addToken(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
    <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2 text-sm">
      <span className="text-xs font-medium text-zinc-300">Color ID</span>
      <select
        name="colorIdentityMode"
        defaultValue={mode || "include"}
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
        title="Any = one selected color; All = every selected color; Exact = no extras; At most = subset; At least = superset."
      >
        {COLOR_MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
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

function activeChip(label: string, value?: string | string[]) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : value;
  if (!text) return null;
  return (
    <span key={label} className="rounded-full bg-zinc-800 px-2 py-1 text-xs">
      {label}: {text}
    </span>
  );
}

export function InventoryAdvancedSearch({
  actionPath,
  params,
  displayMode,
  isAdmin = false,
  isPublic = false,
  players = [],
  locations = [],
  setOptions = [],
  cardNameOptions = [],
  clearHref,
}: InventoryAdvancedSearchProps) {
  const rarity = values(params, "rarity");
  const finish = values(params, "finish").length
    ? values(params, "finish")
    : first(params, "foil") === "true"
      ? ["foil"]
      : first(params, "foil") === "false"
        ? ["nonfoil"]
        : [];
  const source = values(params, "source");
  const locationId =
    values(params, "locationId").length ||
    first(params, "hasLocation") !== "unassigned"
      ? values(params, "locationId")
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
    { value: "unassigned", label: "Unassigned" },
    ...locations.map((location) => ({
      value: location.value,
      label: `${location.kind === "DECK" ? "Deck: " : ""}${location.label}`,
    })),
  ];
  const activeChips = [
    activeChip("Name", first(params, "cardName")),
    activeChip("Type", typeTokens.map(titleCase)),
    activeChip("Oracle", first(params, "oracleText")),
    activeChip("Set", values(params, "set")),
    activeChip("Rarity", rarity.map(titleCase)),
    activeChip("Finish", finish.map(titleCase)),
    activeChip(
      "Color ID",
      colorIdentity.length
        ? `${COLOR_MODE_OPTIONS.find((option) => option.value === first(params, "colorIdentityMode"))?.label || "All"} ${colorIdentity.join(",")}`
        : "",
    ),
    activeChip("Location", locationId),
  ].filter(Boolean);

  return (
    <details open className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <summary className="cursor-pointer font-semibold">
        Advanced Inventory Search
      </summary>
      <form className="mt-3 space-y-3" action={actionPath}>
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="displayMode" value={displayMode} />
        <div className="grid gap-2 lg:grid-cols-[minmax(13rem,1.2fr)_minmax(16rem,1.4fr)_minmax(13rem,1fr)_minmax(13rem,1fr)]">
          <label className="text-xs font-medium text-zinc-300">
            Card name
            <input
              name="cardName"
              list="inventory-card-name-options"
              defaultValue={first(params, "cardName")}
              placeholder="Sol Ring"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm"
              autoComplete="off"
            />
            <datalist id="inventory-card-name-options">
              {cardNameOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <TypeTokenInput initialTokens={typeTokens} />
          <label className="text-xs font-medium text-zinc-300">
            Oracle text
            <input
              name="oracleText"
              defaultValue={first(params, "oracleText")}
              placeholder="draw a card"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-zinc-300">
            Set / expansion
            <input
              name="set"
              list="inventory-set-options"
              defaultValue={values(params, "set").join(",")}
              placeholder="TLA or Avatar"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
            <datalist id="inventory-set-options">
              {setOptions.map((set) => (
                <option key={set.value} value={set.value}>
                  {set.label}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
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
          <label className="min-w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm">
            <span className="text-zinc-400">Language</span>
            <input
              name="language"
              defaultValue={values(params, "language").join(",")}
              placeholder="Any"
              className="ml-2 w-20 bg-transparent outline-none"
            />
          </label>
          {!isPublic ? (
            <MultiSelectDropdown
              label="Location"
              name="locationId"
              options={locationOptions}
              selected={locationId}
              compact
            />
          ) : null}
          {!isPublic ? (
            <label className="min-w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm">
              <span className="text-zinc-400">Visibility: </span>
              <select
                name="visibility"
                defaultValue={first(params, "visibility")}
                className="bg-transparent outline-none"
              >
                <option value="">Any</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="inherit">Default</option>
                <option value="explicitPublic">Explicit public</option>
                <option value="explicitPrivate">Explicit private</option>
              </select>
            </label>
          ) : null}
          {!isPublic ? (
            <MultiSelectDropdown
              label="Source"
              name="source"
              options={SOURCE_OPTIONS}
              selected={source}
              compact
            />
          ) : null}
          {isAdmin && !isPublic ? (
            <label className="min-w-48 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm">
              <span className="text-zinc-400">Owner: </span>
              <select
                name="ownerId"
                defaultValue={first(params, "ownerId")}
                className="bg-transparent outline-none"
              >
                <option value="">All owners</option>
                {players.map((player) => (
                  <option key={player.value} value={player.value}>
                    {player.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!isPublic ? (
            <label className="min-w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm">
              <span className="text-zinc-400">Inventory: </span>
              <select
                name="commitment"
                defaultValue={first(params, "commitment")}
                className="bg-transparent outline-none"
              >
                <option value="">All</option>
                <option value="available">Available</option>
                <option value="committed">Committed</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <ColorIdentityControls
            selected={colorIdentity}
            mode={first(params, "colorIdentityMode")}
          />
          <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2 text-sm">
            <span className="text-xs font-medium text-zinc-300">
              Mana value
            </span>
            <select
              name="mvOp"
              value={mvOp}
              onChange={(event) => setMvOp(event.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            >
              <option value="">Any</option>
              <option value="eq">=</option>
              <option value="lt">&lt;</option>
              <option value="lte">&lt;=</option>
              <option value="gt">&gt;</option>
              <option value="gte">&gt;=</option>
              <option value="between">Between</option>
            </select>
            <input
              name="mv"
              type="number"
              step="0.5"
              defaultValue={first(params, "mv")}
              placeholder="Value"
              className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            />
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
                  className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
                />
                <input
                  name="mvMax"
                  type="number"
                  step="0.5"
                  defaultValue={
                    first(params, "mvMax") || first(params, "manaValueMax")
                  }
                  placeholder="Max"
                  className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
                />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2 text-sm">
            <span className="text-xs font-medium text-zinc-300">USD</span>
            <input
              name="priceMin"
              type="number"
              step="0.01"
              defaultValue={first(params, "priceMin")}
              placeholder="Min"
              className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            />
            <input
              name="priceMax"
              type="number"
              step="0.01"
              defaultValue={first(params, "priceMax")}
              placeholder="Max"
              className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            />
          </div>
        </div>

        {activeChips.length ? (
          <div className="flex flex-wrap gap-1" aria-label="Active filters">
            {activeChips}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button className="rounded border border-sky-700 px-3 py-2 text-sm text-sky-100 hover:bg-sky-950">
            Apply filters
          </button>
          <a
            href={clearHref}
            className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
          >
            Clear filters
          </a>
        </div>
      </form>
    </details>
  );
}
