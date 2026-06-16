export const dynamic = "force-dynamic";

import Link from "next/link";
import { DeckFormat, Visibility } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deckFormatLabel, deckSectionSummaryParts } from "@/lib/decks";
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
  searchParams?: Promise<{ folder?: string }>;
}) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const adminModeActive = scope?.mode === "admin";
  const selectedFolder = (await searchParams)?.folder ?? "all";
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
  const visibleDecks =
    selectedFolder === DECK_FOLDER_UNCATEGORIZED_VALUE
      ? decks.filter((deck) => !deck.folderId)
      : selectedFolder && selectedFolder !== "all"
        ? decks.filter((deck) => deck.folderId === selectedFolder)
        : decks;
  const countFor = (folderId: string | null) =>
    decks.filter((deck) => deck.folderId === folderId).length;

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

      <form
        action={createDeck}
        className="grid gap-3 rounded border border-zinc-800 p-4 md:grid-cols-6"
      >
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

      <section className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3 rounded border border-zinc-800 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Folders</h2>
          </div>
          <nav className="space-y-1 text-sm">
            <Link
              className={cn(
                "block rounded px-2 py-1",
                selectedFolder === "all"
                  ? "bg-sky-950 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
              href="/decks"
            >
              All decks ({decks.length})
            </Link>
            <Link
              className={cn(
                "block rounded px-2 py-1",
                selectedFolder === DECK_FOLDER_UNCATEGORIZED_VALUE
                  ? "bg-sky-950 text-sky-100"
                  : "text-zinc-300 hover:bg-zinc-900",
              )}
              href={`/decks?folder=${DECK_FOLDER_UNCATEGORIZED_VALUE}`}
            >
              Uncategorized ({countFor(null)})
            </Link>
            {folderOptions.map((folder) => (
              <div
                key={folder.id}
                className="space-y-1"
                style={{ marginLeft: `${folder.depth * 0.75}rem` }}
              >
                <Link
                  className={cn(
                    "block rounded px-2 py-1",
                    selectedFolder === folder.id
                      ? "bg-sky-950 text-sky-100"
                      : "text-zinc-300 hover:bg-zinc-900",
                  )}
                  href={`/decks?folder=${folder.id}`}
                >
                  {folder.name} ({countFor(folder.id)})
                </Link>
                <details className="px-2 text-xs text-zinc-400">
                  <summary>Actions</summary>
                  <div className="mt-2 space-y-2">
                    <form action={createDeckFolder} className="flex gap-1">
                      <input type="hidden" name="parentId" value={folder.id} />
                      <input
                        name="name"
                        placeholder="New subfolder"
                        className={cn(filterInputClass, "min-w-0 flex-1")}
                      />
                      <SubmitButton
                        pendingLabel="Adding…"
                        className="rounded border border-zinc-700 px-2"
                      >
                        Add
                      </SubmitButton>
                    </form>
                    <form action={renameDeckFolder} className="flex gap-1">
                      <input type="hidden" name="folderId" value={folder.id} />
                      <input
                        name="name"
                        defaultValue={folder.name}
                        className={cn(filterInputClass, "min-w-0 flex-1")}
                      />
                      <SubmitButton
                        pendingLabel="Renaming…"
                        className="rounded border border-zinc-700 px-2"
                      >
                        Rename
                      </SubmitButton>
                    </form>
                    <form action={moveDeckFolder} className="flex gap-1">
                      <input type="hidden" name="folderId" value={folder.id} />
                      <select
                        name="parentId"
                        className={cn(filterSelectClass, "min-w-0 flex-1")}
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
                        className="rounded border border-zinc-700 px-2"
                      >
                        Move
                      </SubmitButton>
                    </form>
                    <form action={deleteDeckFolder}>
                      <input type="hidden" name="folderId" value={folder.id} />
                      <SubmitButton
                        pendingLabel="Deleting…"
                        className="rounded border border-red-800 px-2 py-1 text-red-200"
                        confirmMessage={`Delete folder “${folder.name}”? Decks and child folders will move up one level.`}
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </details>
              </div>
            ))}
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
        </aside>
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-900 text-left text-zinc-300">
              <tr>
                <th className="p-3">Deck</th>
                {adminModeActive ? <th className="p-3">Owner</th> : null}
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
                  <td className="p-3">{deckFormatLabel(deck.format)}</td>
                  <td className="p-3">
                    <ColorIdentitySymbols
                      value={calculateDeckColorIdentity(
                        deck.cards,
                        deck.format,
                      )}
                    />
                  </td>
                  <td className="p-3">
                    <form action={moveDeckToFolder} className="flex gap-2">
                      <input type="hidden" name="deckId" value={deck.id} />
                      <select
                        name="folderId"
                        defaultValue={deck.folderId ?? ""}
                        className={cn(filterSelectClass, "max-w-48")}
                      >
                        <option value="">Uncategorized</option>
                        {folderOptions.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folderSelectLabel(folder)}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingLabel="Moving…"
                        className="rounded border border-zinc-700 px-2 py-1"
                      >
                        Move
                      </SubmitButton>
                    </form>
                  </td>
                  <td className="p-3">{visibilityLabel(deck.visibility)}</td>
                  <td className="p-3">
                    {deckSectionSummaryParts(deck.cards).join(" · ")}
                  </td>
                  <td className="p-3">{deck.updatedAt.toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className="rounded border border-zinc-700 px-2 py-1"
                        href={`/decks/${deck.id}`}
                      >
                        View/Edit
                      </Link>
                      <form action={deleteDeck}>
                        <input type="hidden" name="deckId" value={deck.id} />
                        <SubmitButton
                          pendingLabel="Deleting…"
                          className="rounded border border-red-800 px-2 py-1 text-red-200"
                          confirmMessage={`Delete deck “${deck.name}”? Inventory and card metadata will not be deleted.`}
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleDecks.length === 0 ? (
                <tr>
                  <td
                    className="p-6 text-zinc-400"
                    colSpan={adminModeActive ? 8 : 7}
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
