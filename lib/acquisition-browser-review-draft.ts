import { z } from "zod";

const printing = z.object({ id: z.string().min(1).max(200), name: z.string().max(300),
  setCode: z.string().max(30), collectorNumber: z.string().max(100), lang: z.string().max(20).nullable(),
  imageUri: z.string().max(4096).nullable(), finishes: z.array(z.string().max(30)).max(10).nullable() }).strict();
export const acquisitionBrowserDraftSchema = z.object({ version: z.literal(1), writeId: z.string().uuid(),
  revision: z.number().int().nonnegative(), selected: printing.nullable(),
  finish: z.enum(["UNKNOWN", "NONFOIL", "FOIL", "ETCHED"]),
  condition: z.enum(["", "NM", "LP", "MP", "HP", "DMG"]), language: z.string().max(20),
  query: z.string().max(300), set: z.string().max(100), number: z.string().max(100) }).strict();
export type AcquisitionBrowserDraft = z.infer<typeof acquisitionBrowserDraftSchema>;
export type DraftScope = { userId: string; batchId: string; photoId: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export const ACQUISITION_DRAFT_CHANGED = "mtg-acquisition-draft-changed";
export const acquisitionDraftPrefix = (scope: Pick<DraftScope, "userId" | "batchId">) =>
  `mtg-review-draft-v1:${[scope.userId, scope.batchId].map(encodeURIComponent).join(":")}:`;
export const acquisitionDraftKey = (scope: DraftScope) =>
  `${acquisitionDraftPrefix(scope)}${encodeURIComponent(scope.photoId)}`;
// Presence protects even an unreadable draft. Parsing belongs to the editor;
// batch eligibility must never silently treat damaged metadata as no correction.
export function listAcquisitionDraftPhotos(storage: Pick<globalThis.Storage, "length" | "key">,
  scope: Pick<DraftScope, "userId" | "batchId">) {
  const prefix = acquisitionDraftPrefix(scope), ids = new Set<string>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      try { ids.add(decodeURIComponent(key.slice(prefix.length))); } catch { /* Invalid key cannot identify a photo. */ }
    }
  }
  return ids;
}
function changed(storage: Storage, scope: DraftScope) {
  if (typeof window === "undefined") return;
  // Storage events cover other tabs; our own tab needs an explicit notification.
  try {
    if (storage === window.localStorage)
      window.dispatchEvent(new CustomEvent(ACQUISITION_DRAFT_CHANGED, { detail: acquisitionDraftKey(scope) }));
  } catch { /* The successful storage operation remains successful. */ }
}
export function readAcquisitionDraft(storage: Storage, scope: DraftScope) {
  const value = storage.getItem(acquisitionDraftKey(scope));
  if (value === null) return null;
  if (value.length > 16384) throw new Error("Draft is too large");
  return acquisitionBrowserDraftSchema.parse(JSON.parse(value));
}
export function saveAcquisitionDraft(storage: Storage, scope: DraftScope, draft: unknown) {
  const writeId = crypto.randomUUID();
  const parsed = acquisitionBrowserDraftSchema.parse({ ...(draft as object), writeId });
  const value = JSON.stringify(parsed);
  if (value.length > 16384) throw new Error("Draft is too large");
  storage.setItem(acquisitionDraftKey(scope), value);
  changed(storage, scope);
  return writeId;
}
export function clearAcquisitionDraft(storage: Storage, scope: DraftScope, writeId?: string) {
  if (writeId) {
    const current = readAcquisitionDraft(storage, scope);
    if (current && current.writeId !== writeId) return false;
  }
  storage.removeItem(acquisitionDraftKey(scope));
  changed(storage, scope);
  return true;
}
