"use client";
import { useEffect, useState } from "react";
import { ACQUISITION_DRAFT_CHANGED, acquisitionDraftPrefix, listAcquisitionDraftPhotos } from "@/lib/acquisition-browser-review-draft";

/** One cache inventory per account/batch, then individual-key notifications.
 * Does not instantiate offscreen editors or rescan storage on progress polls. */
export function useAcquisitionDrafts(userId: string, batchId: string) {
  const prefix = acquisitionDraftPrefix({ userId, batchId });
  const [snapshot, setSnapshot] = useState<{ prefix: string; ready: boolean; ids: Set<string> }>({ prefix: "", ready: false, ids: new Set() });
  useEffect(() => {
    function seed() {
      try { setSnapshot({ prefix, ready: true, ids: listAcquisitionDraftPhotos(localStorage, { userId, batchId }) }); }
      catch { setSnapshot({ prefix, ready: false, ids: new Set() }); }
    }
    function update(key: string | null) {
      if (key === null) { seed(); return; } // Another tab cleared storage.
      if (!key.startsWith(prefix)) return;
      try {
        const id = decodeURIComponent(key.slice(prefix.length));
        const exists = localStorage.getItem(key) !== null;
        setSnapshot(previous => {
          if (previous.prefix !== prefix) return previous;
          const ids = new Set(previous.ids);
          if (exists) ids.add(id); else ids.delete(id);
          return { ...previous, ids };
        });
      } catch { setSnapshot(previous => ({ ...previous, ready: false })); }
    }
    function own(event: Event) { update((event as CustomEvent<string>).detail); }
    function other(event: StorageEvent) {
      try { if (event.storageArea === localStorage) update(event.key); }
      catch { setSnapshot(previous => ({ ...previous, ready: false })); }
    }
    window.addEventListener(ACQUISITION_DRAFT_CHANGED, own);
    window.addEventListener("storage", other);
    seed();
    return () => {
      window.removeEventListener(ACQUISITION_DRAFT_CHANGED, own);
      window.removeEventListener("storage", other);
    };
  }, [userId, batchId, prefix]);
  return { ready: snapshot.prefix === prefix && snapshot.ready, ids: snapshot.prefix === prefix ? snapshot.ids : new Set<string>() };
}
