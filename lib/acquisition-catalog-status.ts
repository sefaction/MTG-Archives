import { z } from "zod";

export const CATALOG_RECONCILIATION_STAGE = "photo-catalog-reconciliation-v1";
export const CATALOG_RESOLVER_VERSION = "catalog-reconciliation-evidence-order-v4";
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
});
export type AcquisitionCatalogStatus = z.infer<typeof catalogStatusSchema>;
export function acquisitionCatalogMessage(
  value?: AcquisitionCatalogStatus | null,
) {
  switch (value?.status) {
    case "CHECKING":
      return "Checking the catalog for missing printings…";
    case "RESOLVED":
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
      return "The printing lookup is incomplete. Check the suggestions manually; this card will not confirm automatically.";
    default:
      return null;
  }
}
