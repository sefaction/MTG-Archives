"use client";

import { useBrowseQuery } from "./useBrowseQuery";
import { useMemo } from "react";
import {
  readDeckLibraryBrowse,
  writeDeckLibraryField,
  type DeckLibraryBrowse,
} from "@/lib/deck-library-browse";

export function useDeckLibraryBrowse() {
  const { params, change } = useBrowseQuery();
  const browse = useMemo(() => readDeckLibraryBrowse(params), [params]);
  function setter<K extends keyof DeckLibraryBrowse>(field: K) {
    return (
      update:
        | DeckLibraryBrowse[K]
        | ((current: DeckLibraryBrowse[K]) => DeckLibraryBrowse[K]),
    ) =>
      change((params) => {
        const current = readDeckLibraryBrowse(params)[field];
        const value = typeof update === "function" ? update(current) : update;
        writeDeckLibraryField(params, field, value);
      });
  }
  return { browse, setter };
}
