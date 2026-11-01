import { z } from "zod";

export const CATALOG_RECONCILIATION_STAGE = "photo-catalog-reconciliation-v1";
export const CATALOG_RESOLVER_VERSION = "catalog-reconciliation-local-snapshot-v26";
export const catalogStatusSchema = z.object({
  status: z.enum([
    "CHECKING",
    "RESOLVED",
    "NOT_FOUND",
    "UNREADABLE",
    "PROVIDER_ERROR",
    "INCOMPLETE",
  ]),
  printingCoverage: z.enum(["CHECKED", "UNRESOLVED"]),
  addedPrintings: z.number().int().nonnegative().optional(),
  sourceCoverage: z.array(z.object({
    kind: z.literal("BULK_SNAPSHOT"), version: z.literal(1),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceUpdatedAt: z.string().datetime({ offset: true }), language: z.literal("en"),
  }).strict()).max(32).optional(),
});
export type AcquisitionCatalogStatus = z.infer<typeof catalogStatusSchema>;
export function acquisitionCatalogMessage(
  value?: AcquisitionCatalogStatus | null,
) {
  switch (value?.status) {
    case "CHECKING":
      return "Checking the catalog for missing printings…";
    case "RESOLVED":
      if (value.sourceCoverage?.length)
        return `English paper printings checked against the saved Scryfall catalog from ${value.sourceCoverage[0].sourceUpdatedAt.slice(0, 10)}.`;
      return value.addedPrintings
        ? "Missing printing information was added from Scryfall. Check the match below."
        : "Printing information checked against Scryfall’s catalog.";
    case "NOT_FOUND":
      return "Scryfall did not find a matching printing. Correct the name or printing details below.";
    case "UNREADABLE":
      return "There was not enough readable card text for a catalog lookup. Search manually or try another photo.";
    case "PROVIDER_ERROR":
      return "Scryfall is unavailable. Your photo and suggestions are saved; the catalog check will retry automatically.";
    case "INCOMPLETE":
      if (value.sourceCoverage?.length)
        return `The saved English paper catalog from ${value.sourceCoverage[0].sourceUpdatedAt.slice(0, 10)} could not verify this lookup. It remains incomplete; check the suggestions manually.`;
      return "The printing lookup is incomplete. Check the suggestions manually; this card will not confirm automatically.";
    default:
      return null;
  }
}
