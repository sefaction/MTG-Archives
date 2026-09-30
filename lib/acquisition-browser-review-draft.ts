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
export const acquisitionDraftKey = (scope: DraftScope) =>
  `mtg-review-draft-v1:${[scope.userId, scope.batchId, scope.photoId].map(encodeURIComponent).join(":")}`;
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
  return writeId;
}
export function clearAcquisitionDraft(storage: Storage, scope: DraftScope, writeId?: string) {
  if (writeId && readAcquisitionDraft(storage, scope)?.writeId !== writeId) return false;
  storage.removeItem(acquisitionDraftKey(scope));
  return true;
}
