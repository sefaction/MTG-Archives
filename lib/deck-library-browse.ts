import { listPage, listPageSize } from "./list-browse";

type Params = Pick<URLSearchParams, "get" | "getAll">;
export type DeckLibraryBrowse = {
  search: string;
  folder: string;
  includedTags: string[];
  excludedTags: string[];
  includedBrackets: string[];
  excludedBrackets: string[];
  sort: "name" | "format" | "bracket" | "folder" | "cards" | "updated";
  direction: "asc" | "desc";
  view: "table" | "cards";
  page: number;
  pageSize: number;
};
const values = (params: Params, key: string) =>
  [
    ...new Set(
      params.getAll(key).filter((value) => value && value.length <= 128),
    ),
  ].slice(0, 100);
export function readDeckLibraryBrowse(params: Params): DeckLibraryBrowse {
  const sort = params.get("sort") || "updated";
  return {
    search: (params.get("q") || "").slice(0, 200),
    folder: params.get("folder") || "all",
    includedTags: values(params, "tag"),
    excludedTags: values(params, "excludeTag"),
    includedBrackets: values(params, "bracket").filter((value) =>
      /^[1-5]$/.test(value),
    ),
    excludedBrackets: values(params, "excludeBracket").filter((value) =>
      /^[1-5]$/.test(value),
    ),
    sort: ["name", "format", "bracket", "folder", "cards", "updated"].includes(
      sort,
    )
      ? (sort as DeckLibraryBrowse["sort"])
      : "updated",
    direction: params.get("sortDir") === "asc" ? "asc" : "desc",
    view: params.get("view") === "cards" ? "cards" : "table",
    page: listPage(params.get("page")),
    pageSize: listPageSize(params.get("pageSize")),
  };
}
const keys = {
  search: "q",
  folder: "folder",
  includedTags: "tag",
  excludedTags: "excludeTag",
  includedBrackets: "bracket",
  excludedBrackets: "excludeBracket",
  sort: "sort",
  direction: "sortDir",
  view: "view",
  page: "page",
  pageSize: "pageSize",
} as const;
const defaults = {
  search: "",
  folder: "all",
  sort: "updated",
  direction: "desc",
  view: "table",
  page: 1,
  pageSize: 25,
};
export function writeDeckLibraryField<K extends keyof DeckLibraryBrowse>(
  params: URLSearchParams,
  field: K,
  next: DeckLibraryBrowse[K],
) {
  const key = keys[field];
  params.delete(key);
  const values = Array.isArray(next) ? next : [String(next)];
  const fallback = defaults[field as keyof typeof defaults];
  for (const value of values)
    if (Array.isArray(next) || value !== String(fallback))
      params.append(key, value);
  if (field !== "page" && field !== "pageSize" && field !== "view")
    params.delete("page");
  if (field === "pageSize") params.delete("page");
}
