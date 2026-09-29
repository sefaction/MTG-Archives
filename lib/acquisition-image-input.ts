import { z } from "zod";

export const acquisitionImageInputKindSchema = z.enum(["PHOTO", "CARD_SCAN"]);
export type AcquisitionImageInputKind = z.infer<typeof acquisitionImageInputKindSchema>;

// Keep existing raw-photo callers compatible. Only a declared scan needs the
// bounded hint envelope; original bytes and their digest remain unchanged.
export function acquisitionNativePhotoInput(bytes: Buffer, inputKind: AcquisitionImageInputKind) {
  acquisitionImageInputKindSchema.parse(inputKind);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Photo exceeds bounds");
  if (inputKind === "PHOTO") return bytes;
  const metadata = Buffer.from(JSON.stringify({inputKind}));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  return Buffer.concat([length, metadata, bytes]);
}
