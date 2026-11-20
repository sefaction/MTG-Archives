import {scannerLayoutTemplateSchema} from "./acquisition-scanner-layout";
import { z } from "zod";
import { acquisitionManualRegionSchema, type AcquisitionManualRegion } from "./acquisition-manual-region";
import {preparedCardSchema, type PreparedCard} from './acquisition-prepared-card';

export const acquisitionImageInputKindSchema = z.enum(["PHOTO", "CARD_SCAN"]);
export type AcquisitionImageInputKind = z.infer<typeof acquisitionImageInputKindSchema>;

export function acquisitionNativePreparedInput(bytes: Buffer, inputKind: AcquisitionImageInputKind,
  preparation?: PreparedCard, manualRegion?: AcquisitionManualRegion, candidateScryfallIds?: string[]) {
  if (!preparation && !candidateScryfallIds) return acquisitionNativePhotoInput(bytes, inputKind, undefined, manualRegion);
  acquisitionImageInputKindSchema.parse(inputKind);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Photo exceeds bounds');
  const metadata = Buffer.from(JSON.stringify({inputKind,
    ...(preparation ? {preparedFrame: preparedCardSchema.parse(preparation)} : {}),
    ...(manualRegion ? {manualRegion: acquisitionManualRegionSchema.parse(manualRegion)} : {}),
    ...(candidateScryfallIds ? {candidateScryfallIds: z.array(z.string().uuid()).min(1).max(12).parse(candidateScryfallIds)} : {})}));
  if (metadata.length > 2048) throw new Error('Prepared image hint exceeds bounds');
  const length = Buffer.alloc(4); length.writeUInt32BE(metadata.length);
  return Buffer.concat([length, metadata, bytes]);
}

// Keep existing raw-photo callers compatible. Only a declared scan needs the
// bounded hint envelope; original bytes and their digest remain unchanged.
export function acquisitionNativePhotoInput(bytes: Buffer, inputKind: AcquisitionImageInputKind,
  recognitionTask?: "WHOLE_PHOTO_TEXT", manualRegion?: AcquisitionManualRegion, scannerLayoutProfile?: string) {
  acquisitionImageInputKindSchema.parse(inputKind);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Photo exceeds bounds");
  if (recognitionTask !== undefined && recognitionTask !== "WHOLE_PHOTO_TEXT")
    throw new Error("Unknown recognition task");
  const region = manualRegion === undefined ? undefined : acquisitionManualRegionSchema.parse(manualRegion);
  if(scannerLayoutProfile!==undefined){
    if(inputKind!=='CARD_SCAN'||region||recognitionTask)throw new Error('Scanner layout requires an automatic scan');
    scannerLayoutTemplateSchema.parse(JSON.parse(scannerLayoutProfile));
  }
  if (region && recognitionTask) throw new Error("Whole-photo fallback cannot replace an explicit card region");
  if (inputKind === "PHOTO" && !recognitionTask && !region) return bytes;
  const metadata = Buffer.from(JSON.stringify({inputKind, ...(recognitionTask ? {recognitionTask} : {}),
    ...(region ? {manualRegion: region} : {}), ...(scannerLayoutProfile ? {scannerLayoutProfile} : {})}));
  if (metadata.length > 1020) throw new Error("Image hint exceeds bounds");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  return Buffer.concat([length, metadata, bytes]);
}

// Separate native hint: an inferred outline never masquerades as an operator
// boundary. Admission/provenance must be checked before constructing this frame.
export function acquisitionNativeReferenceInput(bytes: Buffer, region: AcquisitionManualRegion) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Photo exceeds bounds");
  const checked = acquisitionManualRegionSchema.parse(region);
  const metadata = Buffer.from(JSON.stringify({ inputKind: "CARD_SCAN", referenceRegion: checked }));
  if (metadata.length > 1020) throw new Error("Image hint exceeds bounds");
  const length = Buffer.alloc(4); length.writeUInt32BE(metadata.length);
  return Buffer.concat([length, metadata, bytes]);
}
