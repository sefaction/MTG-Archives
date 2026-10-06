import { createHash } from "node:crypto";
import { z } from "zod";
import { acquisitionImageInputKindSchema } from "./acquisition-image-input";
import { visualNativeSchema } from "./acquisition-visual";
import { acquisitionManualRegionSchema, sameAcquisitionManualRegion } from "./acquisition-manual-region";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({
  version: z.literal(1), ownerPlayerId: z.string().min(1).max(100),
  photoDigest: digest, descriptor: digest, inputKind: acquisitionImageInputKindSchema,
  manualRegion: acquisitionManualRegionSchema.optional(),
}).strict();

export function visualReuseIdentity(value: z.input<typeof requestSchema>) {
  const request = requestSchema.parse(value);
  return {...request, key: createHash("sha256").update(JSON.stringify(request)).digest("hex")};
}
export type VisualReuseIdentity = ReturnType<typeof visualReuseIdentity>;

export function checkedVisualNative(raw: unknown, identity: VisualReuseIdentity) {
  const visual = visualNativeSchema.parse(raw);
  if (visual.photoDigest !== identity.photoDigest || visual.descriptor !== identity.descriptor ||
      !sameAcquisitionManualRegion(visual.geometry.manualRegion, identity.manualRegion))
    throw new Error("Visual processing identity changed");
  return visual;
}

// Legacy outputs omit the request envelope (especially PHOTO/CARD_SCAN). Never
// reconstruct identity from a proposal or a historical photo's mutable owner.
export function reusableVisualNative(output: unknown, identity: VisualReuseIdentity) {
  try {
    if (Buffer.byteLength(JSON.stringify(output)) > 65536) return null;
    const record = z.object({visualReuse: requestSchema.extend({key: digest}), visual: z.unknown()}).parse(output);
    const {key, ...request} = record.visualReuse;
    const saved = visualReuseIdentity(request);
    if (saved.key !== key || saved.key !== identity.key) return null;
    return checkedVisualNative(record.visual, identity);
  } catch { return null; }
}
