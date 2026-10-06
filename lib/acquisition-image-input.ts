import { z } from "zod";
import { acquisitionManualRegionSchema, type AcquisitionManualRegion } from "./acquisition-manual-region";

export const acquisitionImageInputKindSchema = z.enum(["PHOTO", "CARD_SCAN"]);
export type AcquisitionImageInputKind = z.infer<typeof acquisitionImageInputKindSchema>;

// Keep existing raw-photo callers compatible. Only a declared scan needs the
// bounded hint envelope; original bytes and their digest remain unchanged.
export function acquisitionNativePhotoInput(bytes: Buffer, inputKind: AcquisitionImageInputKind,
  recognitionTask?: "WHOLE_PHOTO_TEXT", manualRegion?: AcquisitionManualRegion) {
  acquisitionImageInputKindSchema.parse(inputKind);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Photo exceeds bounds");
  if (recognitionTask !== undefined && recognitionTask !== "WHOLE_PHOTO_TEXT")
    throw new Error("Unknown recognition task");
  const region = manualRegion === undefined ? undefined : acquisitionManualRegionSchema.parse(manualRegion);
  if (region && recognitionTask) throw new Error("Whole-photo fallback cannot replace an explicit card region");
  if (inputKind === "PHOTO" && !recognitionTask && !region) return bytes;
  const metadata = Buffer.from(JSON.stringify({inputKind, ...(recognitionTask ? {recognitionTask} : {}),
    ...(region ? {manualRegion: region} : {})}));
  if (metadata.length > 1020) throw new Error("Image hint exceeds bounds");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  return Buffer.concat([length, metadata, bytes]);
}
