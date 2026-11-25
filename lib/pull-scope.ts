import { z } from "zod";

const id = z.string().min(1).max(200);
export const pullScopeInput = z
  .object({
    excludedLocations: z.array(id).max(1000).optional(),
    excludedSections: z
      .array(
        z.object({ locationId: id, section: z.string().max(120) }).strict(),
      )
      .max(1000)
      .optional(),
    excludedItems: z.array(id).max(1000).optional(),
  })
  .strict();
export type PullScope = z.infer<typeof pullScopeInput>;
export type PullLocation = {
  id: string;
  parentLocationId?: string | null;
  isBulk?: boolean;
  type?: string | null;
};
export function locationIsBulk(
  id: string | null | undefined,
  locations: Map<string, PullLocation>,
) {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const row = locations.get(id);
    if (!row) return false;
    if (row.isBulk || row.type === "Bulk cleanup") return true;
    id = row.parentLocationId;
  }
  return false;
}
export function pullExcluded(
  scope: PullScope | undefined,
  itemId: string,
  locationId: string | null | undefined,
  section: string | null,
  locations?: Map<string, PullLocation>,
) {
  if (scope?.excludedItems?.includes(itemId)) return true;
  if (
    scope?.excludedSections?.some(
      (row) =>
        row.locationId === (locationId ?? "unassigned") &&
        row.section === (section ?? ""),
    )
  )
    return true;
  const seen = new Set<string>();
  let id = locationId ?? "unassigned";
  while (id && !seen.has(id)) {
    if (scope?.excludedLocations?.includes(id)) return true;
    seen.add(id);
    id = locations?.get(id)?.parentLocationId ?? "";
  }
  return false;
}
export const heldPullInput = z
  .object({
    id,
    quantity: z.number().int().positive().max(1_000_000),
    stamp: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const bulkScopeInput = pullScopeInput.extend({
  held: z.array(heldPullInput).max(500).optional(),
});
export type BulkScope = z.infer<typeof bulkScopeInput>;
export const huntAdjustmentsInput = pullScopeInput
  .extend({
    includeBulk: z.boolean().optional(),
    printings: z
      .array(
        z
          .object({
            requestId: z.string().min(1).max(500),
            cardId: id,
            finish: z.enum(["NONFOIL", "FOIL", "ETCHED"]),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    held: z
      .array(heldPullInput.extend({ requestId: z.string().min(1).max(500) }))
      .max(500)
      .optional(),
    completed: z
      .array(
        z
          .object({
            requestId: z.string().min(1).max(500),
            quantity: z.number().int().positive().max(1_000_000),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
  })
  .superRefine((value, ctx) => {
    for (const rows of [value.printings, value.completed])
      if (
        rows &&
        new Set(rows.map((row) => row.requestId)).size !== rows.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Each card request can have only one adjustment.",
        });
    const keys = value.held?.map((row) =>
      JSON.stringify([row.requestId, row.id]),
    );
    if (keys && new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Choose each held pull once." });
  });
export type HuntAdjustments = z.infer<typeof huntAdjustmentsInput>;

export type PullBrowse = {
  search: string;
  sort: "location" | "name" | "quantity";
  desc: boolean;
  locationId: string;
  pageSize: number;
};
export const pullBrowseInput = z
  .object({
    search: z.string().max(120).default(""),
    sort: z.enum(["location", "name", "quantity"]).default("location"),
    desc: z.boolean().default(false),
    locationId: z.string().max(200).default(""),
    pageSize: z
      .union([z.literal(25), z.literal(50), z.literal(100), z.literal(250)])
      .default(25),
  })
  .strict();
