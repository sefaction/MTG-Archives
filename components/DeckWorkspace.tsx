"use client";

import Link from "next/link";
import {
  type DragEvent,
  type KeyboardEvent,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ColorIdentitySymbols } from "@/components/mtg/ColorIdentitySymbols";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";
import {
  createDeck,
  createDeckFolder,
  deleteDeckFolder,
  moveDeckFolder,
  renameDeckFolder,
  updateDeckFromIndex,
} from "@/app/decks/actions";

const ALL_FOLDERS = "all";
const UNCATEGORIZED = "__uncategorized__";
type Option = { value: string; label: string };

export type DeckWorkspaceFolder = {
  id: string;
  name: string;
  parentId?: string | null;
  depth: number;
  path: string;
};

export type DeckWorkspaceTag = {
  id: string;
  name: string;
  count: number;
  ownerLabel?: string;
};

export type DeckWorkspaceDeck = {
  id: string;
  name: string;
  description: string | null;
  format: string;
  formatLabel: string;
  visibility: string;
  visibilityLabel: string;
  bracket: number | null;
  folderId: string | null;
  folderPath: string;
  tags: Array<{ id: string; name: string }>;
  colorIdentity: string;
  cardSummary: string;
  cardCount: number;
  committedCardCount: number;
  commanderNames: string[];
  commanderImages: string[];
  updatedAt: string;
  ownerLabel?: string;
};

type SortField = "name" | "format" | "bracket" | "folder" | "cards" | "updated";
type ViewMode = "table" | "cards";

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function TagEditor({
  availableTags,
  initialTags = [],
  inputName = "tags",
}: {
  availableTags: DeckWorkspaceTag[];
  initialTags?: string[];
  inputName?: string;
}) {
  const [selected, setSelected] = useState(initialTags);
  const [query, setQuery] = useState("");
  const selectedNames = useMemo(
    () => new Set(selected.map(normalized)),
    [selected],
  );
  const suggestions = useMemo(() => {
    const needle = normalized(query);
    return availableTags
      .filter((tag) => !selectedNames.has(normalized(tag.name)))
      .filter((tag) => !needle || normalized(tag.name).includes(needle))
      .slice(0, 6);
  }, [availableTags, query, selectedNames]);

  function addTag(raw: string) {
    const clean = raw.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const existing = availableTags.find(
      (tag) => normalized(tag.name) === normalized(clean),
    );
    const name = existing?.name ?? clean;
    if (!selectedNames.has(normalized(name))) {
      setSelected((current) => [...current, name]);
    }
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(query);
    }
    if (event.key === "Backspace" && !query && selected.length) {
      setSelected((current) => current.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={inputName} value={selected.join(", ")} />
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 focus-within:border-sky-700 focus-within:ring-1 focus-within:ring-sky-800">
        {selected.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-cyan-900 bg-cyan-950/50 px-2 py-0.5 text-xs text-cyan-100"
          >
            {tag}
            <button
              type="button"
              onClick={() =>
                setSelected((current) =>
                  current.filter((candidate) => candidate !== tag),
                )
              }
              className="text-cyan-400 hover:text-white"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length ? "Add another tag" : "Add tags"}
          className="min-w-36 flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-100 outline-none"
        />
      </div>
      {query && suggestions.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Tag suggestions">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => addTag(tag.name)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:border-cyan-700 hover:text-cyan-100"
            >
              {tag.name}
              <span className="ml-1 text-zinc-500">{tag.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">
        Choose an existing tag or press Enter to create a new one.
      </p>
    </div>
  );
}

function SortButton({
  field,
  activeField,
  direction,
  onSort,
  children,
}: {
  field: SortField;
  activeField: SortField;
  direction: "asc" | "desc";
  onSort: (field: SortField) => void;
  children: React.ReactNode;
}) {
  const active = field === activeField;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold hover:bg-zinc-800 hover:text-white"
    >
      {children}
      <span className={active ? "text-sky-300" : "text-zinc-600"}>
        {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function MultiStateFilterCloud({
  label,
  options,
  included,
  excluded,
  includeMode,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string; count?: number }>;
  included: string[];
  excluded: string[];
  includeMode: "all" | "any";
  onChange: (included: string[], excluded: string[]) => void;
}) {
  function cycle(id: string) {
    if (included.includes(id)) {
      onChange(
        included.filter((candidate) => candidate !== id),
        [...excluded, id],
      );
      return;
    }
    if (excluded.includes(id)) {
      onChange(
        included,
        excluded.filter((candidate) => candidate !== id),
      );
      return;
    }
    onChange([...included, id], excluded);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
            {label}
          </h3>
          <p className="text-[11px] text-zinc-600">
            Included values match {includeMode === "all" ? "all" : "any"}. Click
            to cycle include → exclude → clear.
          </p>
        </div>
        {included.length || excluded.length ? (
          <button
            type="button"
            onClick={() => onChange([], [])}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 shadow-sm transition hover:border-red-500 hover:bg-red-950/60 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
            Clear {label.toLowerCase()}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label={`${label} filters`}>
        {options.map((option) => {
          const isIncluded = included.includes(option.id);
          const isExcluded = excluded.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => cycle(option.id)}
              aria-pressed={isIncluded || isExcluded}
              className={cn(
                "relative rounded border px-2.5 py-1 text-xs transition",
                isIncluded
                  ? "border-sky-600 bg-sky-950/80 text-sky-50 shadow-sm shadow-sky-950"
                  : isExcluded
                    ? "border-red-600 bg-red-950/80 pl-8 text-red-50 shadow-sm shadow-red-950"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200",
              )}
            >
              {isExcluded ? (
                <span className="absolute left-1.5 top-0.5 text-[8px] font-black uppercase tracking-tight text-red-300">
                  Not
                </span>
              ) : null}
              {option.label}
              {option.count !== undefined ? (
                <span
                  className={cn(
                    "ml-1",
                    isIncluded || isExcluded
                      ? "text-current opacity-60"
                      : "text-zinc-700",
                  )}
                >
                  {option.count}
                </span>
              ) : null}
            </button>
          );
        })}
        {!options.length ? (
          <span className="text-xs text-zinc-600">No values yet.</span>
        ) : null}
      </div>
    </div>
  );
}

export function DeckWorkspace({
  decks,
  folders,
  tags,
  formatOptions,
  visibilityOptions,
  bracketOptions,
  initialFolder = ALL_FOLDERS,
  initialTag = "",
  initialBracket = "",
  adminModeActive = false,
}: {
  decks: DeckWorkspaceDeck[];
  folders: DeckWorkspaceFolder[];
  tags: DeckWorkspaceTag[];
  formatOptions: Option[];
  visibilityOptions: Option[];
  bracketOptions: Option[];
  initialFolder?: string;
  initialTag?: string;
  initialBracket?: string;
  adminModeActive?: boolean;
}) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState(initialFolder);
  const [includedTagIds, setIncludedTagIds] = useState(
    initialTag ? [initialTag] : [],
  );
  const [excludedTagIds, setExcludedTagIds] = useState<string[]>([]);
  const [includedBrackets, setIncludedBrackets] = useState(
    initialBracket ? [initialBracket] : [],
  );
  const [excludedBrackets, setExcludedBrackets] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [organizationUnlocked, setOrganizationUnlocked] = useState(false);
  const [draggedFolderId, setDraggedFolderId] = useState("");
  const [folderMessage, setFolderMessage] = useState("");
  const [managedFolderId, setManagedFolderId] = useState(folders[0]?.id ?? "");
  const [editingDeck, setEditingDeck] = useState<DeckWorkspaceDeck | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const foldersByParent = useMemo(() => {
    const map = new Map<string, DeckWorkspaceFolder[]>();
    for (const folder of folders) {
      const parent = folder.parentId ?? "";
      map.set(parent, [...(map.get(parent) ?? []), folder]);
    }
    return map;
  }, [folders]);
  const deckCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deck of decks) {
      const key = deck.folderId ?? UNCATEGORIZED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [decks]);

  const filteredDecks = useMemo(() => {
    const needle = normalized(search);
    const result = decks.filter((deck) => {
      if (
        folderFilter === UNCATEGORIZED
          ? deck.folderId
          : folderFilter !== ALL_FOLDERS && deck.folderId !== folderFilter
      ) {
        return false;
      }
      const deckTagIds = new Set(deck.tags.map((tag) => tag.id));
      if (includedTagIds.some((tagId) => !deckTagIds.has(tagId))) {
        return false;
      }
      if (excludedTagIds.some((tagId) => deckTagIds.has(tagId))) {
        return false;
      }
      const bracket = String(deck.bracket ?? "");
      if (includedBrackets.length && !includedBrackets.includes(bracket)) {
        return false;
      }
      if (excludedBrackets.includes(bracket)) {
        return false;
      }
      if (
        needle &&
        !normalized(
          [
            deck.name,
            deck.description ?? "",
            deck.folderPath,
            deck.formatLabel,
            ...deck.tags.map((tag) => tag.name),
          ].join(" "),
        ).includes(needle)
      ) {
        return false;
      }
      return true;
    });
    return result.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = left.name.localeCompare(right.name);
          break;
        case "format":
          comparison = left.formatLabel.localeCompare(right.formatLabel);
          break;
        case "bracket":
          comparison = (left.bracket ?? 0) - (right.bracket ?? 0);
          break;
        case "folder":
          comparison = left.folderPath.localeCompare(right.folderPath);
          break;
        case "cards":
          comparison = left.cardCount - right.cardCount;
          break;
        case "updated":
          comparison =
            new Date(left.updatedAt).getTime() -
            new Date(right.updatedAt).getTime();
          break;
      }
      if (!comparison) comparison = left.name.localeCompare(right.name);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    decks,
    excludedBrackets,
    excludedTagIds,
    folderFilter,
    includedBrackets,
    includedTagIds,
    search,
    sortDirection,
    sortField,
  ]);

  function chooseSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "updated" ? "desc" : "asc");
  }

  function chooseView(next: ViewMode) {
    setViewMode(next);
  }

  function includeTag(tagId: string) {
    setExcludedTagIds((current) =>
      current.filter((candidate) => candidate !== tagId),
    );
    setIncludedTagIds((current) =>
      current.includes(tagId) ? current : [...current, tagId],
    );
  }

  function moveFolder(targetParentId: string | null) {
    if (!organizationUnlocked || !draggedFolderId) return;
    const sourceId = draggedFolderId;
    setDraggedFolderId("");
    setFolderMessage("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("folderId", sourceId);
        formData.set("parentId", targetParentId ?? "");
        await moveDeckFolder(formData);
        setFolderMessage(
          targetParentId
            ? `Folder moved into ${folderById.get(targetParentId)?.name ?? "folder"}.`
            : "Folder moved to the top level.",
        );
        router.refresh();
      } catch (error) {
        setFolderMessage(
          error instanceof Error ? error.message : "Unable to move folder.",
        );
      }
    });
  }

  function handleFolderDragStart(
    event: DragEvent<HTMLElement>,
    folderId: string,
  ) {
    if (!organizationUnlocked) {
      event.preventDefault();
      return;
    }
    setDraggedFolderId(folderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", folderId);
  }

  function renderFolderTree(parentId = "", depth = 0): React.ReactNode {
    return (foldersByParent.get(parentId) ?? []).map((folder) => {
      const selected = folderFilter === folder.id;
      return (
        <div key={folder.id}>
          <div
            draggable={organizationUnlocked}
            onDragStart={(event) => handleFolderDragStart(event, folder.id)}
            onDragEnd={() => setDraggedFolderId("")}
            onDragOver={(event) => {
              if (!organizationUnlocked) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              moveFolder(folder.id);
            }}
            className={cn(
              "group flex items-center gap-1 rounded-md border border-transparent px-2 py-1.5 text-sm transition",
              selected
                ? "border-sky-900 bg-sky-950/70 text-sky-100"
                : "text-zinc-300 hover:bg-zinc-900",
              organizationUnlocked &&
                "cursor-grab border-dashed hover:border-amber-700/70",
              draggedFolderId === folder.id && "opacity-40",
            )}
            style={{ marginLeft: `${depth * 0.8}rem` }}
          >
            {organizationUnlocked ? (
              <span className="text-zinc-600" aria-hidden="true">
                ⠿
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setFolderFilter(folder.id)}
              className="min-w-0 flex-1 truncate text-left"
              title={folder.path}
            >
              <span className="mr-1 text-zinc-500" aria-hidden="true">
                ▸
              </span>
              {folder.name}
            </button>
            <span className="text-xs text-zinc-600">
              {deckCountByFolder.get(folder.id) ?? 0}
            </span>
          </div>
          {renderFolderTree(folder.id, depth + 1)}
        </div>
      );
    });
  }

  async function saveDeckFromIndex(formData: FormData) {
    setFolderMessage("");
    await updateDeckFromIndex(formData);
    setEditingDeck(null);
    router.refresh();
  }

  const managedFolder = folderById.get(managedFolderId) ?? null;

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="min-w-60 flex-1">
              <span className="sr-only">Search decks</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search decks, folders, formats, or tags"
                className={cn(filterInputClass, "w-full")}
              />
            </label>
            {(search ||
              includedTagIds.length ||
              excludedTagIds.length ||
              includedBrackets.length ||
              excludedBrackets.length ||
              folderFilter !== ALL_FOLDERS) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setIncludedTagIds([]);
                  setExcludedTagIds([]);
                  setIncludedBrackets([]);
                  setExcludedBrackets([]);
                  setFolderFilter(ALL_FOLDERS);
                }}
                className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">
              {filteredDecks.length} of {decks.length}
            </span>
            <div className="inline-flex rounded border border-zinc-700 p-0.5">
              <button
                type="button"
                onClick={() => chooseView("table")}
                className={cn(
                  "rounded px-3 py-1.5 text-sm",
                  viewMode === "table"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => chooseView("cards")}
                className={cn(
                  "rounded px-3 py-1.5 text-sm",
                  viewMode === "cards"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                Cards
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-4 border-t border-zinc-800 pt-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <MultiStateFilterCloud
            label="Tags"
            options={tags.map((tag) => ({
              id: tag.id,
              label: tag.name,
              count: tag.count,
            }))}
            included={includedTagIds}
            excluded={excludedTagIds}
            includeMode="all"
            onChange={(included, excluded) => {
              setIncludedTagIds(included);
              setExcludedTagIds(excluded);
            }}
          />
          <MultiStateFilterCloud
            label="Brackets"
            options={bracketOptions
              .filter((option) => option.value)
              .map((option) => ({
                id: option.value,
                label: option.label,
                count: decks.filter(
                  (deck) => String(deck.bracket ?? "") === option.value,
                ).length,
              }))}
            included={includedBrackets}
            excluded={excludedBrackets}
            includeMode="any"
            onChange={(included, excluded) => {
              setIncludedBrackets(included);
              setExcludedBrackets(excluded);
            }}
          />
        </div>
      </section>

      <details className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <summary className="cursor-pointer font-semibold text-sky-100">
          + New deck
        </summary>
        <form action={createDeck} className="mt-4 grid gap-3 md:grid-cols-6">
          <label className={cn(filterFieldClass, "md:col-span-2")}>
            Deck name
            <input
              name="name"
              required
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <label className={filterFieldClass}>
            Format
            <select
              name="format"
              defaultValue="CASUAL"
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {formatOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Bracket
            <select
              name="bracket"
              defaultValue=""
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {bracketOptions.map((option) => (
                <option key={option.value || "unset"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Visibility
            <select
              name="visibility"
              defaultValue="INHERIT"
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {visibilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Folder
            <select
              name="folderId"
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              <option value="">Uncategorized</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </label>
          <label className={cn(filterFieldClass, "md:col-span-3")}>
            Description
            <textarea
              name="description"
              rows={3}
              className={cn(filterTextareaClass, "mt-1 w-full")}
            />
          </label>
          <div className="md:col-span-3">
            <span className={filterFieldClass}>Tags</span>
            <div className="mt-1">
              <TagEditor availableTags={tags} />
            </div>
          </div>
          <div className="md:col-span-6 flex justify-end">
            <SubmitButton
              pendingLabel="Creating…"
              className={filterPrimaryButtonClass}
            >
              Create deck
            </SubmitButton>
          </div>
        </form>
      </details>

      <section className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="self-start rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 xl:sticky xl:top-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Folders</h2>
              <p className="text-xs text-zinc-500">
                {organizationUnlocked ? "Organization unlocked" : "Browse mode"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOrganizationUnlocked((current) => !current);
                setDraggedFolderId("");
                setFolderMessage("");
              }}
              className={cn(
                "rounded border px-2.5 py-1.5 text-xs font-medium",
                organizationUnlocked
                  ? "border-amber-700 bg-amber-950/40 text-amber-100"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-900",
              )}
            >
              {organizationUnlocked ? "🔓 Lock" : "🔒 Unlock"}
            </button>
          </div>
          <nav className="space-y-1" aria-label="Deck folders">
            <button
              type="button"
              onClick={() => setFolderFilter(ALL_FOLDERS)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                folderFilter === ALL_FOLDERS
                  ? "bg-sky-950/70 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
            >
              <span>All decks</span>
              <span className="text-xs text-zinc-600">{decks.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setFolderFilter(UNCATEGORIZED)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                folderFilter === UNCATEGORIZED
                  ? "bg-sky-950/70 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
            >
              <span>Uncategorized</span>
              <span className="text-xs text-zinc-600">
                {deckCountByFolder.get(UNCATEGORIZED) ?? 0}
              </span>
            </button>
            <div className="pt-1">{renderFolderTree()}</div>
          </nav>

          {organizationUnlocked ? (
            <div className="mt-3 space-y-3 border-t border-amber-900/50 pt-3">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  moveFolder(null);
                }}
                className="rounded-lg border border-dashed border-amber-800/70 bg-amber-950/20 p-3 text-center text-xs text-amber-100"
              >
                Drop here to move a folder to the top level
              </div>
              <p className="text-xs text-zinc-400">
                Drag a folder onto another folder to nest it. Folder structure
                cannot change while locked.
              </p>
              <form action={createDeckFolder} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Create folder
                </h3>
                <input
                  name="name"
                  required
                  placeholder="Folder name"
                  className={cn(filterInputClass, "w-full text-sm")}
                />
                <select
                  name="parentId"
                  className={cn(filterSelectClass, "w-full text-sm")}
                  defaultValue=""
                >
                  <option value="">Top level</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      Inside {folder.path}
                    </option>
                  ))}
                </select>
                <SubmitButton
                  pendingLabel="Creating…"
                  className={cn(filterPrimaryButtonClass, "w-full")}
                >
                  Create folder
                </SubmitButton>
              </form>
              {folders.length ? (
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Rename or delete
                  </h3>
                  <select
                    value={managedFolderId}
                    onChange={(event) => setManagedFolderId(event.target.value)}
                    className={cn(filterSelectClass, "w-full text-sm")}
                  >
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.path}
                      </option>
                    ))}
                  </select>
                  {managedFolder ? (
                    <>
                      <form action={renameDeckFolder} className="flex gap-2">
                        <input
                          type="hidden"
                          name="folderId"
                          value={managedFolder.id}
                        />
                        <input
                          name="name"
                          required
                          defaultValue={managedFolder.name}
                          key={managedFolder.id}
                          className={cn(
                            filterInputClass,
                            "min-w-0 flex-1 text-sm",
                          )}
                        />
                        <SubmitButton
                          pendingLabel="…"
                          className="rounded border border-zinc-700 px-2 text-xs hover:bg-zinc-900"
                        >
                          Rename
                        </SubmitButton>
                      </form>
                      <form action={deleteDeckFolder}>
                        <input
                          type="hidden"
                          name="folderId"
                          value={managedFolder.id}
                        />
                        <SubmitButton
                          pendingLabel="Deleting…"
                          confirmMessage={`Delete folder “${managedFolder.name}”? Decks and child folders will move up one level.`}
                          className="w-full rounded border border-red-900 px-2 py-1.5 text-xs text-red-200 hover:bg-red-950/40"
                        >
                          Delete selected folder
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                </div>
              ) : null}
              {folderMessage ? (
                <p
                  className={cn(
                    "rounded border px-2 py-1.5 text-xs",
                    folderMessage.toLowerCase().includes("unable") ||
                      folderMessage.toLowerCase().includes("cannot")
                      ? "border-red-900 text-red-200"
                      : "border-emerald-900 text-emerald-200",
                  )}
                >
                  {isPending ? "Moving folder…" : folderMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>

        <div className="min-w-0">
          {viewMode === "table" ? (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/90 text-left text-zinc-300">
                  <tr>
                    <th className="p-3">
                      <SortButton
                        field="name"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Deck
                      </SortButton>
                    </th>
                    {adminModeActive ? <th className="p-3">Owner</th> : null}
                    <th className="p-3">
                      <SortButton
                        field="format"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Format
                      </SortButton>
                    </th>
                    <th className="p-3">
                      <SortButton
                        field="bracket"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Bracket
                      </SortButton>
                    </th>
                    <th className="p-3">Colors</th>
                    <th className="p-3">
                      <SortButton
                        field="folder"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Folder
                      </SortButton>
                    </th>
                    <th className="p-3">
                      <SortButton
                        field="cards"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Cards
                      </SortButton>
                    </th>
                    <th className="p-3">
                      <SortButton
                        field="updated"
                        activeField={sortField}
                        direction={sortDirection}
                        onSort={chooseSort}
                      >
                        Updated
                      </SortButton>
                    </th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDecks.map((deck) => (
                    <tr
                      key={deck.id}
                      className="border-t border-zinc-800 align-top transition hover:bg-zinc-900/50"
                    >
                      <td className="min-w-60 p-3">
                        <Link
                          href={`/decks/${deck.id}`}
                          className="font-semibold text-sky-100 hover:text-sky-300"
                        >
                          {deck.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {deck.tags.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => includeTag(tag.id)}
                              className="rounded-full border border-cyan-900/80 bg-cyan-950/40 px-1.5 py-0.5 text-[11px] text-cyan-100 hover:border-cyan-600"
                            >
                              {tag.name}
                            </button>
                          ))}
                          <span className="rounded-full border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500">
                            {deck.visibilityLabel}
                          </span>
                        </div>
                      </td>
                      {adminModeActive ? (
                        <td className="p-3 text-zinc-400">{deck.ownerLabel}</td>
                      ) : null}
                      <td className="p-3 text-zinc-300">{deck.formatLabel}</td>
                      <td className="p-3 text-zinc-300">
                        {deck.bracket ? `Bracket ${deck.bracket}` : "—"}
                      </td>
                      <td className="p-3">
                        <ColorIdentitySymbols value={deck.colorIdentity} />
                      </td>
                      <td className="max-w-52 p-3 text-zinc-300">
                        <button
                          type="button"
                          onClick={() =>
                            setFolderFilter(deck.folderId ?? UNCATEGORIZED)
                          }
                          className="block max-w-full truncate text-left hover:text-sky-200"
                          title={deck.folderPath}
                        >
                          {deck.folderPath}
                        </button>
                      </td>
                      <td
                        className="p-3 text-zinc-300"
                        title={deck.cardSummary}
                      >
                        {deck.cardCount}
                      </td>
                      <td className="whitespace-nowrap p-3 text-zinc-400">
                        {new Date(deck.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1.5">
                          <Link
                            href={`/decks/${deck.id}`}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            onClick={() => setEditingDeck(deck)}
                            className="rounded border border-sky-900 px-2 py-1 text-xs text-sky-100 hover:bg-sky-950/60"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredDecks.length ? (
                    <tr>
                      <td
                        colSpan={adminModeActive ? 9 : 8}
                        className="p-8 text-center text-zinc-500"
                      >
                        No decks match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filteredDecks.map((deck) => (
                <article
                  key={deck.id}
                  className="group relative isolate min-h-[27rem] overflow-hidden rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-950 to-zinc-900/70 p-4 transition hover:-translate-y-0.5 hover:border-zinc-500 hover:shadow-2xl"
                >
                  {deck.commanderImages.length ? (
                    <>
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-20 flex overflow-hidden"
                      >
                        {deck.commanderImages
                          .slice(0, 2)
                          .map((image, index) => (
                            <div
                              key={`${image}-${index}`}
                              className="min-w-0 flex-1 scale-105 bg-cover bg-center opacity-85 transition duration-300 group-hover:scale-100 group-hover:opacity-95"
                              style={{ backgroundImage: `url(${image})` }}
                            />
                          ))}
                      </div>
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/10 to-black/85"
                      />
                    </>
                  ) : null}
                  <div className="flex min-h-[25rem] flex-col">
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/decks/${deck.id}`}
                          className="min-w-0 truncate rounded-md bg-black/40 px-2 py-1 text-xl font-bold text-white drop-shadow backdrop-blur-[2px] hover:text-sky-200"
                        >
                          {deck.name}
                        </Link>
                        <span className="shrink-0 rounded-md bg-black/35 px-1.5 py-1 backdrop-blur-[2px]">
                          <ColorIdentitySymbols value={deck.colorIdentity} />
                        </span>
                      </div>
                      {deck.commanderNames.length ? (
                        <p className="inline-block max-w-full rounded-md bg-black/35 px-2 py-1 text-sm font-medium text-amber-100 drop-shadow backdrop-blur-[2px]">
                          {deck.commanderNames.join(" & ")}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-100">
                        <span className="rounded-md bg-black/35 px-2 py-1 backdrop-blur-[2px]">
                          {deck.formatLabel}
                        </span>
                        {deck.bracket ? (
                          <span className="rounded-md bg-black/35 px-2 py-1 backdrop-blur-[2px]">
                            Bracket {deck.bracket}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setFolderFilter(deck.folderId ?? UNCATEGORIZED)
                          }
                          className="min-w-0 max-w-[45%] truncate rounded-md bg-black/35 px-2 py-1 text-left text-sm text-zinc-100 backdrop-blur-[2px] hover:text-sky-200"
                          title={deck.folderPath}
                        >
                          {deck.folderPath}
                        </button>
                        <div className="flex max-w-[55%] flex-wrap justify-end gap-1">
                          {deck.tags.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => includeTag(tag.id)}
                              className="rounded-full border border-cyan-700/80 bg-cyan-950/85 px-2 py-0.5 text-xs text-cyan-50 hover:border-cyan-400"
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-200">
                        <span
                          className="rounded-md bg-black/35 px-2 py-1 backdrop-blur-[2px]"
                          title={deck.cardSummary}
                        >
                          {deck.cardCount} cards
                        </span>
                        <span className="rounded-md bg-black/35 px-2 py-1 backdrop-blur-[2px]">
                          Updated{" "}
                          {new Date(deck.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="rounded-md bg-black/35 p-2 backdrop-blur-[2px]">
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium text-zinc-100">
                            Committal progress
                          </span>
                          <span className="text-zinc-300">
                            {deck.committedCardCount} / {deck.cardCount}
                          </span>
                        </div>
                        <div
                          className="h-2 overflow-hidden rounded-full bg-zinc-800"
                          role="progressbar"
                          aria-label={`${deck.name} committal progress`}
                          aria-valuemin={0}
                          aria-valuemax={deck.cardCount}
                          aria-valuenow={deck.committedCardCount}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-emerald-400"
                            style={{
                              width: `${
                                deck.cardCount
                                  ? Math.round(
                                      (deck.committedCardCount /
                                        deck.cardCount) *
                                        100,
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/decks/${deck.id}`}
                          className="flex-1 rounded border border-zinc-500 bg-zinc-950/80 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-zinc-800"
                        >
                          Open deck
                        </Link>
                        <button
                          type="button"
                          onClick={() => setEditingDeck(deck)}
                          className="rounded border border-sky-700 bg-sky-950/80 px-3 py-1.5 text-sm font-medium text-sky-50 hover:bg-sky-900"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {editingDeck ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editingDeck.name}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditingDeck(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Edit deck</h2>
                <p className="text-sm text-zinc-500">
                  Update its organization without leaving the deck list.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDeck(null)}
                className="rounded p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"
                aria-label="Close deck editor"
              >
                ×
              </button>
            </div>
            <form
              action={saveDeckFromIndex}
              className="grid gap-4 md:grid-cols-2"
            >
              <input type="hidden" name="deckId" value={editingDeck.id} />
              <label className={cn(filterFieldClass, "md:col-span-2")}>
                Name
                <input
                  name="name"
                  required
                  defaultValue={editingDeck.name}
                  className={cn(filterInputClass, "mt-1 w-full")}
                />
              </label>
              <label className={filterFieldClass}>
                Format
                <select
                  name="format"
                  defaultValue={editingDeck.format}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {formatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={filterFieldClass}>
                Bracket
                <select
                  name="bracket"
                  defaultValue={editingDeck.bracket ?? ""}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {bracketOptions.map((option) => (
                    <option key={option.value || "unset"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={filterFieldClass}>
                Folder
                <select
                  name="folderId"
                  defaultValue={editingDeck.folderId ?? ""}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  <option value="">Uncategorized</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.path}
                    </option>
                  ))}
                </select>
              </label>
              <label className={filterFieldClass}>
                Visibility
                <select
                  name="visibility"
                  defaultValue={editingDeck.visibility}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {visibilityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="md:col-span-2">
                <span className={filterFieldClass}>Tags</span>
                <div className="mt-1">
                  <TagEditor
                    key={editingDeck.id}
                    availableTags={tags}
                    initialTags={editingDeck.tags.map((tag) => tag.name)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-4 md:col-span-2">
                <Link
                  href={`/decks/${editingDeck.id}`}
                  className="text-sm text-zinc-400 hover:text-sky-200"
                >
                  Open full deck settings
                </Link>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingDeck(null)}
                    className="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                  <SubmitButton
                    pendingLabel="Saving…"
                    className={filterPrimaryButtonClass}
                  >
                    Save changes
                  </SubmitButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
