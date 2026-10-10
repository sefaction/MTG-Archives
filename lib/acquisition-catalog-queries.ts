import { createHash } from "node:crypto";
import { z } from "zod";
import {
  acquisitionCollectorKey,
  type RecognitionText,
} from "./acquisition-recognition";
import { acquisitionFooterObservations } from "./acquisition-footer";
import { acquisitionPhotoTextSchema, type AcquisitionPhotoText } from "./acquisition-photo-text";

export const catalogQuerySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("printing"),
      set: z.string().regex(/^[a-z0-9]{2,8}$/),
      number: z.string().regex(/^[a-z0-9★†-]{1,30}$/i),
      language: z.string().regex(/^[a-z]{2,3}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("name"),
      name: z.string().trim().min(3).max(200),
      fuzzy: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("id"), id: z.string().uuid() }).strict(),
]);
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export function catalogQueryKey(raw: CatalogQuery) {
  const query = catalogQuerySchema.parse(raw);
  const canonical =
    query.kind === "name"
      ? {
          kind: query.kind,
          name: query.name.normalize("NFKC").toLowerCase(),
          fuzzy: Boolean(query.fuzzy),
        }
      : query.kind === "printing"
        ? {
            kind: query.kind,
            set: query.set.toLowerCase(),
            number: acquisitionCollectorKey(query.number),
            language: query.language,
          }
        : query;
  return createHash("sha256")
    // Refresh name lookups once so older false NOT_FOUND entries cannot mask
    // paper editions. Explicit printing/ID caches retain their identities.
    .update(JSON.stringify({ version: query.kind === "name" ? 2 : 1, query: canonical }))
    .digest("hex");
}

// Extraction intentionally does not consult local catalog sets. A new set must
// remain eligible for external lookup. Never combine different orientations.
export function acquisitionCatalogQueries(
  orientations: { rotationDegrees: number; text: RecognitionText }[],
  photoText?: AcquisitionPhotoText,
) {
  const printing = new Map<string, CatalogQuery>();
  const names = new Map<string, CatalogQuery>();
  for (const { text } of orientations) {
    if (
      text.title.length > 100 ||
      text.footer.length > 100 ||
      [...text.title, ...text.footer].some((s) => s.length > 2000)
    )
      throw new Error("OCR lookup evidence exceeds bounds");
    const {identifiers, collectors} = acquisitionFooterObservations(text.footer, text.footerSupplemental);
    // Conflicting footer readings remain evidence, not an API request explosion.
    if (identifiers.length <= 2 && collectors.length <= 2)
      for (const identifier of identifiers)
        for (const number of collectors) {
          const {set, language} = identifier;
          const query: CatalogQuery = {
            kind: "printing",
            set,
            number,
            language,
          };
          printing.set(catalogQueryKey(query), query);
        }
    for (const line of text.title) {
      const name = line.trim().replace(/\s+/g, " ");
      if (
        name.length < 3 ||
        name.length > 120 ||
        (name.match(/\p{L}/gu)?.length ?? 0) < 3
      )
        continue;
      const query: CatalogQuery = { kind: "name", name };
      names.set(catalogQueryKey(query), query);
    }
  }
  const hintNames = new Map<string, CatalogQuery>();
  if (photoText) for (const reading of acquisitionPhotoTextSchema.parse(photoText).readings) {
    // Spatially ordered whole-photo lines remain name-search hints. No set,
    // collector or language tokens are extracted from this unlocalized source.
    for (const line of reading.text.slice(0, 2)) {
      const name = line.trim().replace(/\s+/g, " ");
      if (name.length < 3 || name.length > 120 || (name.match(/\p{L}/gu)?.length ?? 0) < 3) continue;
      const query: CatalogQuery = { kind: "name", name };
      hintNames.set(catalogQueryKey(query), query);
    }
  }
  return {
    ...(photoText ? { photoTextNames: [...hintNames.values()].slice(0, 4) } : {}),
    printings: [...printing.values()].slice(0, 4),
    names: [...names.values()]
      .sort(
        (a, b) =>
          (b.kind === "name" ? b.name.length : 0) -
          (a.kind === "name" ? a.name.length : 0),
      )
      .slice(0, 6),
  };
}
