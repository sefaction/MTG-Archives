import { z } from "zod";
const id = z.string().min(1).max(200);
export const acquisitionCommitSelectionSchema = z
  .object({
    photoIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose each card once",
      ),
    locationId: id,
    section: z.string().trim().max(100),
  })
  .strict();
export const acquisitionCommitRequestSchema = acquisitionCommitSelectionSchema
  .extend({
    requestKey: z.string().uuid(),
    previewToken: z.string().regex(/^[a-f0-9]{64}$/),
    overfillReason: z.string().trim().min(3).max(500).nullable(),
  })
  .strict();
export type AcquisitionCommitSelection = z.infer<
  typeof acquisitionCommitSelectionSchema
>;
export type AcquisitionCommitPreview = {
  token: string;
  count: number;
  destination: {
    locationId: string;
    name: string;
    section: string | null;
    revision: number;
    totalQuantity: number;
    sectionQuantity: number;
    totalCapacity: number | null;
    sectionCapacity: number | null;
    remaining: number | null;
  };
  overfill: number;
  cards: {
    photoId: string;
    position: number;
    name: string;
    setCode: string;
    collectorNumber: string;
    finish: string;
    condition: string;
    language: string;
  }[];
};
export type AcquisitionCommitReceipt = {
  id: string;
  count: number;
  createdAt: string;
  inventoryItemIds: string[];
  locationId: string;
  section: string | null;
  replay: boolean;
};
