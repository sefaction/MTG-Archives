import { DeckFormat, DeckSection } from "@prisma/client";

export const DECK_FOLDER_ROOT_VALUE = "__root__";
export const DECK_FOLDER_UNCATEGORIZED_VALUE = "__uncategorized__";
export const WUBRG = ["W", "U", "B", "R", "G"] as const;

type FolderNodeInput = {
  id: string;
  parentId?: string | null;
  name: string;
  sortOrder?: number | null;
};
export type DeckFolderOption = FolderNodeInput & {
  depth: number;
  path: string;
};

export function buildDeckFolderOptions(
  folders: FolderNodeInput[],
): DeckFolderOption[] {
  const byParent = new Map<string, FolderNodeInput[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), folder]);
  }
  for (const [, children] of byParent) {
    children.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
    );
  }
  const result: DeckFolderOption[] = [];
  const visit = (
    parentId: string,
    depth: number,
    parentPath: string,
    seen: Set<string>,
  ) => {
    for (const folder of byParent.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      result.push({ ...folder, depth, path });
      visit(folder.id, depth + 1, path, new Set([...seen, folder.id]));
    }
  };
  visit("", 0, "", new Set());
  return result;
}

export function folderSelectLabel(folder: DeckFolderOption) {
  return `${"— ".repeat(folder.depth)}${folder.path}`;
}

type ColorCard = {
  section?: DeckSection | string;
  isCommander?: boolean | null;
  card?: { colorIdentity?: unknown; colors?: unknown } | null;
};

function colorsFrom(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;/|{}"]+/)
      : [];
  return raw
    .map(String)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => WUBRG.includes(c as any));
}

export function calculateDeckColorIdentity(
  cards: ColorCard[],
  format?: DeckFormat | string,
) {
  const commanderCards = cards.filter(
    (card) => card.section === DeckSection.COMMANDER || card.isCommander,
  );
  const source =
    (format === DeckFormat.COMMANDER && commanderCards.length) ||
    commanderCards.length
      ? commanderCards
      : cards;
  const set = new Set<string>();
  for (const row of source) {
    for (const color of colorsFrom(row.card?.colorIdentity ?? row.card?.colors))
      set.add(color);
  }
  return WUBRG.filter((color) => set.has(color)).join("");
}

export function canMoveFolder(
  folderId: string,
  newParentId: string | null | undefined,
  folders: Array<{ id: string; parentId?: string | null }>,
) {
  if (!newParentId) return true;
  if (folderId === newParentId) return false;
  let cursor: string | null | undefined = newParentId;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  while (cursor) {
    if (cursor === folderId) return false;
    cursor = byId.get(cursor)?.parentId;
  }
  return true;
}
