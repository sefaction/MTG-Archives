export const dynamic = "force-dynamic";

import Link from "next/link";
import { DeckFormat, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deckFormatLabel, deckSectionSummaryParts } from "@/lib/decks";
import {
  bracketSelectOptions,
  formatDeckBracket,
  parseDeckBracket,
} from "@/lib/deck-brackets";
import { ColorIdentitySymbols } from "@/components/mtg/ColorIdentitySymbols";
import {
  buildDeckFolderOptions,
  calculateDeckColorIdentity,
  DECK_FOLDER_UNCATEGORIZED_VALUE,
  folderSelectLabel,
} from "@/lib/deck-folders";
import { visibilityLabel } from "@/lib/visibility";
import {
  createDeck,
  createDeckFolder,
  deleteDeck,
  deleteDeckFolder,
  moveDeckFolder,
  moveDeckToFolder,
  renameDeckFolder,
  updateDeck,
} from "./actions";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";

export default async function DecksPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string; bracket?: string }>;
}) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const adminModeActive = scope?.mode === "admin";
  const params = await searchParams;
  const selectedFolder = params?.folder ?? "all";
  const selectedBracket = parseDeckBracket(params?.bracket ?? null);
  const folders = await prisma.deckFolder.findMany({
    where: adminModeActive ? {} : { ownerUserId: user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const folderOptions = buildDeckFolderOptions(folders);
  const decks = await prisma.deck.findMany({
    where: adminModeActive ? {} : { ownerUserId: user.id },
    include: {
      cards: {
        select: {
          quantity: true,
          section: true,
          isCommander: true,
          card: { select: { colorIdentity: true, colors: true } },
        },
      },
      ownerUser: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const folderFilteredDecks =
    selectedFolder === DECK_FOLDER_UNCATEGORIZED_VALUE
      ? decks.filter((deck) => !deck.folderId)
      : selectedFolder && selectedFolder !== "all"
        ? decks.filter((deck) => deck.folderId === selectedFolder)
        : decks;
  const visibleDecks = selectedBracket
    ? folderFilteredDecks.filter((deck) => deck.bracket === selectedBracket)
    : folderFilteredDecks;
  const countFor = (folderId: string | null) =>
    decks.filter((deck) => deck.folderId === folderId).length;
  const folderById = new Map(
    folderOptions.map((folder) => [folder.id, folder]),
  );
  const childFoldersByParent = new Map<string, typeof folderOptions>();
  for (const folder of folderOptions) {
    const key = folder.parentId ?? "";
    childFoldersByParent.set(key, [
      ...(childFoldersByParent.get(key) ?? []),
      folder,
    ]);
  }

  function folderPath(folderId?: string | null) {
    if (!folderId) return "Uncategorized";
    return folderById.get(folderId)?.path ?? "Unknown folder";
  }

  function decksHref(next: { folder?: string; bracket?: number | null }) {
    const query = new URLSearchParams();
    const folder = next.folder ?? selectedFolder;
    const bracket = next.bracket === undefined ? selectedBracket : next.bracket;
    if (folder && folder !== "all") query.set("folder", folder);
    if (bracket) query.set("bracket", String(bracket));
    const suffix = query.toString();
    return suffix ? `/decks?${suffix}` : "/decks";
  }

  function renderFolderActions(folder: (typeof folderOptions)[number]) {
    return (
      <details className="relative ml-auto">
        <summary
          className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-700"
          aria-label={`Folder actions for ${folder.name}`}
        >
          ⋯
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-64 space-y-2 rounded border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
          <form action={createDeckFolder} className="space-y-1">
            <input type="hidden" name="parentId" value={folder.id} />
            <input
              name="name"
              placeholder="New subfolder"
              className={cn(filterInputClass, "w-full text-xs")}
            />
            <SubmitButton
              pendingLabel="Adding…"
              className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
            >
              New subfolder
            </SubmitButton>
          </form>
          <form action={renameDeckFolder} className="space-y-1">
            <input type="hidden" name="folderId" value={folder.id} />
            <input
              name="name"
              defaultValue={folder.name}
              className={cn(filterInputClass, "w-full text-xs")}
            />
            <SubmitButton
              pendingLabel="Renaming…"
              className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
            >
              Rename
            </SubmitButton>
          </form>
          <form action={moveDeckFolder} className="space-y-1">
            <input type="hidden" name="folderId" value={folder.id} />
            <select
              name="parentId"
              defaultValue={folder.parentId ?? ""}
              className={cn(filterSelectClass, "w-full text-xs")}
            >
              <option value="">Top level</option>
              {folderOptions
                .filter((option) => option.id !== folder.id)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {folderSelectLabel(option)}
                  </option>
                ))}
            </select>
            <SubmitButton
              pendingLabel="Moving…"
              className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
            >
              Move folder
            </SubmitButton>
          </form>
          <form
            action={deleteDeckFolder}
            className="border-t border-zinc-800 pt-2"
          >
            <input type="hidden" name="folderId" value={folder.id} />
            <SubmitButton
              pendingLabel="Deleting…"
              className="w-full rounded border border-red-800 px-2 py-1 text-left text-xs text-red-200"
              confirmMessage={`Delete folder “${folder.name}”? Decks and child folders will move up one level.`}
            >
              Delete folder
            </SubmitButton>
          </form>
        </div>
      </details>
    );
  }

  function renderFolderTree(parentId = "", depth = 0): React.ReactNode {
    return (childFoldersByParent.get(parentId) ?? []).map((folder) => {
      const children = childFoldersByParent.get(folder.id) ?? [];
      const row = (
        <div
          className={cn(
            "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-sm",
            selectedFolder === folder.id
              ? "bg-sky-950 text-sky-100"
              : "text-zinc-300 hover:bg-zinc-900",
          )}
        >
          <span className="w-4 text-center text-zinc-500">
            {children.length ? "▾" : ""}
          </span>
          <Link
            href={decksHref({ folder: folder.id })}
            className="min-w-0 flex-1 truncate"
            title={folder.path}
          >
            <span aria-hidden="true">📁</span> {folder.name}
            <span className="ml-1 text-xs text-zinc-500">
              ({countFor(folder.id)})
            </span>
          </Link>
          {renderFolderActions(folder)}
        </div>
      );

      if (!children.length) {
        return (
          <div key={folder.id} style={{ marginLeft: `${depth * 0.85}rem` }}>
            {row}
          </div>
        );
      }

      return (
        <details
          key={folder.id}
          open
          style={{ marginLeft: `${depth * 0.85}rem` }}
        >
          <summary className="list-none">{row}</summary>
          <div className="ml-3 border-l border-zinc-800 pl-2">
            {renderFolderTree(folder.id, 0)}
          </div>
        </details>
      );
    });
  }

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Decks</h1>
        <p className="text-zinc-400">
          Create deck lists independently from inventory while still seeing
          owned and missing card counts.
        </p>
        {adminModeActive ? (
          <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
            Admin mode is active. This index includes decks across users.
          </p>
        ) : null}
      </section>

      <details className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-sky-100">
          + New deck
        </summary>
        <form action={createDeck} className="mt-3 grid gap-3 md:grid-cols-7">
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
              defaultValue={DeckFormat.CASUAL}
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {Object.values(DeckFormat).map((format) => (
                <option key={format} value={format}>
                  {deckFormatLabel(format)}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Visibility
            <select
              name="visibility"
              defaultValue={Visibility.INHERIT}
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {Object.values(Visibility).map((visibility) => (
                <option key={visibility} value={visibility}>
                  {visibilityLabel(visibility)}
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
              {bracketSelectOptions().map((option) => (
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
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              <option value="">Uncategorized</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderSelectLabel(folder)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <SubmitButton
              pendingLabel="Creating…"
              className={cn(filterPrimaryButtonClass, "w-full")}
            >
              Create deck
            </SubmitButton>
          </div>
          <label className={cn(filterFieldClass, "md:col-span-6")}>
            Description
            <textarea
              name="description"
              rows={2}
              className={cn(filterTextareaClass, "mt-1 w-full")}
            />
          </label>
        </form>
      </details>

      <section className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3 rounded border border-zinc-800 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Folders</h2>
          </div>
          <nav className="space-y-1 text-sm" aria-label="Deck folders">
            <Link
              className={cn(
                "flex items-center justify-between rounded px-2 py-1",
                selectedFolder === "all"
                  ? "bg-sky-950 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
              href={decksHref({ folder: "all" })}
            >
              <span>All decks</span>
              <span className="text-xs text-zinc-500">{decks.length}</span>
            </Link>
            <Link
              className={cn(
                "flex items-center justify-between rounded px-2 py-1",
                selectedFolder === DECK_FOLDER_UNCATEGORIZED_VALUE
                  ? "bg-sky-950 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
              href={decksHref({ folder: DECK_FOLDER_UNCATEGORIZED_VALUE })}
            >
              <span>Uncategorized</span>
              <span className="text-xs text-zinc-500">{countFor(null)}</span>
            </Link>
            <div className="space-y-0.5 pt-1">{renderFolderTree()}</div>
          </nav>
          <form
            action={createDeckFolder}
            className="space-y-2 border-t border-zinc-800 pt-3"
          >
            <input type="hidden" name="parentId" value="" />
            <input
              name="name"
              placeholder="New top-level folder"
              className={cn(filterInputClass, "w-full")}
            />
            <SubmitButton
              pendingLabel="Creating…"
              className={filterPrimaryButtonClass}
            >
              Create folder
            </SubmitButton>
          </form>
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <h2 className="text-sm font-semibold">Brackets</h2>
            <nav className="space-y-1 text-sm" aria-label="Deck brackets">
              <Link
                className={cn(
                  "flex items-center justify-between rounded px-2 py-1",
                  !selectedBracket
                    ? "bg-sky-950 text-sky-100"
                    : "text-zinc-300 hover:bg-zinc-900",
                )}
                href={decksHref({ bracket: null })}
              >
                <span>All brackets</span>
                <span className="text-xs text-zinc-500">
                  {folderFilteredDecks.length}
                </span>
              </Link>
              {bracketSelectOptions()
                .filter((option) => option.value)
                .map((option) => {
                  const bracket = Number(option.value);
                  return (
                    <Link
                      key={option.value}
                      className={cn(
                        "flex items-center justify-between rounded px-2 py-1",
                        selectedBracket === bracket
                          ? "bg-sky-950 text-sky-100"
                          : "text-zinc-300 hover:bg-zinc-900",
                      )}
                      href={decksHref({ bracket })}
                    >
                      <span>{option.label}</span>
                      <span className="text-xs text-zinc-500">
                        {
                          folderFilteredDecks.filter(
                            (deck) => deck.bracket === bracket,
                          ).length
                        }
                      </span>
                    </Link>
                  );
                })}
            </nav>
          </div>
        </aside>
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-900 text-left text-zinc-300">
              <tr>
                <th className="p-3">Deck</th>
                {adminModeActive ? <th className="p-3">Owner</th> : null}
                <th className="p-3">Bracket</th>
                <th className="p-3">Format</th>
                <th className="p-3">Colors</th>
                <th className="p-3">Folder</th>
                <th className="p-3">Visibility</th>
                <th className="p-3">Cards</th>
                <th className="p-3">Updated</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleDecks.map((deck) => (
                <tr key={deck.id} className="border-t border-zinc-800">
                  <td className="p-3 font-medium text-sky-100">
                    <Link href={`/decks/${deck.id}`}>{deck.name}</Link>
                  </td>
                  {adminModeActive ? (
                    <td className="p-3">{deck.ownerUser.displayName}</td>
                  ) : null}
                  <td className="p-3">{formatDeckBracket(deck.bracket)}</td>
                  <td className="p-3">{deckFormatLabel(deck.format)}</td>
                  <td className="p-3">
                    <ColorIdentitySymbols
                      value={calculateDeckColorIdentity(
                        deck.cards,
                        deck.format,
                      )}
                    />
                  </td>
                  <td className="max-w-56 p-3 text-zinc-300">
                    <span
                      className="block truncate"
                      title={folderPath(deck.folderId)}
                    >
                      {folderPath(deck.folderId)}
                    </span>
                  </td>
                  <td className="p-3">{visibilityLabel(deck.visibility)}</td>
                  <td className="p-3">
                    {deckSectionSummaryParts(deck.cards).join(" · ")}
                  </td>
                  <td className="p-3">{deck.updatedAt.toLocaleDateString()}</td>
                  <td className="p-3 text-right">
                    <details className="relative inline-block text-left">
                      <summary
                        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded border border-zinc-700 text-lg text-zinc-300 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-sky-700"
                        aria-label={`Actions for ${deck.name}`}
                      >
                        ⋮
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
                        <Link
                          className="block rounded px-2 py-1 text-sm text-sky-100 hover:bg-zinc-900"
                          href={`/decks/${deck.id}`}
                        >
                          Open deck
                        </Link>
                        <form
                          action={moveDeckToFolder}
                          className="space-y-1 border-t border-zinc-800 pt-2"
                        >
                          <input type="hidden" name="deckId" value={deck.id} />
                          <label className="block text-xs text-zinc-400">
                            Move to folder
                            <select
                              name="folderId"
                              defaultValue={deck.folderId ?? ""}
                              className={cn(
                                filterSelectClass,
                                "mt-1 w-full text-xs",
                              )}
                            >
                              <option value="">Uncategorized</option>
                              {folderOptions.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.path}
                                </option>
                              ))}
                            </select>
                          </label>
                          <SubmitButton
                            pendingLabel="Moving…"
                            className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
                          >
                            Save folder
                          </SubmitButton>
                        </form>
                        <form
                          action={updateDeck}
                          className="space-y-1 border-t border-zinc-800 pt-2"
                        >
                          <input type="hidden" name="deckId" value={deck.id} />
                          <input
                            type="hidden"
                            name="description"
                            value={deck.description ?? ""}
                          />
                          <input
                            type="hidden"
                            name="format"
                            value={deck.format}
                          />
                          <input
                            type="hidden"
                            name="visibility"
                            value={deck.visibility}
                          />
                          <input
                            type="hidden"
                            name="bracket"
                            value={deck.bracket ?? ""}
                          />
                          <input
                            type="hidden"
                            name="folderId"
                            value={deck.folderId ?? ""}
                          />
                          <label className="block text-xs text-zinc-400">
                            Rename
                            <input
                              name="name"
                              defaultValue={deck.name}
                              className={cn(
                                filterInputClass,
                                "mt-1 w-full text-xs",
                              )}
                            />
                          </label>
                          <SubmitButton
                            pendingLabel="Renaming…"
                            className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
                          >
                            Save name
                          </SubmitButton>
                        </form>
                        <form
                          action={updateDeck}
                          className="space-y-1 border-t border-zinc-800 pt-2"
                        >
                          <input type="hidden" name="deckId" value={deck.id} />
                          <input type="hidden" name="name" value={deck.name} />
                          <input
                            type="hidden"
                            name="description"
                            value={deck.description ?? ""}
                          />
                          <input
                            type="hidden"
                            name="format"
                            value={deck.format}
                          />
                          <input
                            type="hidden"
                            name="folderId"
                            value={deck.folderId ?? ""}
                          />
                          <input
                            type="hidden"
                            name="bracket"
                            value={deck.bracket ?? ""}
                          />
                          <label className="block text-xs text-zinc-400">
                            Visibility
                            <select
                              name="visibility"
                              defaultValue={deck.visibility}
                              className={cn(
                                filterSelectClass,
                                "mt-1 w-full text-xs",
                              )}
                            >
                              {Object.values(Visibility).map((visibility) => (
                                <option key={visibility} value={visibility}>
                                  {visibilityLabel(visibility)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <SubmitButton
                            pendingLabel="Saving…"
                            className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
                          >
                            Save visibility
                          </SubmitButton>
                        </form>
                        <form
                          action={updateDeck}
                          className="space-y-1 border-t border-zinc-800 pt-2"
                        >
                          <input type="hidden" name="deckId" value={deck.id} />
                          <input type="hidden" name="name" value={deck.name} />
                          <input
                            type="hidden"
                            name="description"
                            value={deck.description ?? ""}
                          />
                          <input
                            type="hidden"
                            name="format"
                            value={deck.format}
                          />
                          <input
                            type="hidden"
                            name="visibility"
                            value={deck.visibility}
                          />
                          <input
                            type="hidden"
                            name="folderId"
                            value={deck.folderId ?? ""}
                          />
                          <label className="block text-xs text-zinc-400">
                            Bracket
                            <select
                              name="bracket"
                              defaultValue={deck.bracket ?? ""}
                              className={cn(
                                filterSelectClass,
                                "mt-1 w-full text-xs",
                              )}
                            >
                              {bracketSelectOptions().map((option) => (
                                <option
                                  key={option.value || "unset"}
                                  value={option.value}
                                >
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <SubmitButton
                            pendingLabel="Savingâ€¦"
                            className="w-full rounded border border-zinc-700 px-2 py-1 text-left text-xs"
                          >
                            Save bracket
                          </SubmitButton>
                        </form>
                        <form
                          action={deleteDeck}
                          className="border-t border-zinc-800 pt-2"
                        >
                          <input type="hidden" name="deckId" value={deck.id} />
                          <SubmitButton
                            pendingLabel="Deleting…"
                            className="w-full rounded border border-red-800 px-2 py-1 text-left text-xs text-red-200"
                            confirmMessage={`Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`}
                          >
                            Delete deck
                          </SubmitButton>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {visibleDecks.length === 0 ? (
                <tr>
                  <td
                    className="p-6 text-zinc-400"
                    colSpan={adminModeActive ? 10 : 9}
                  >
                    No decks in this folder.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
