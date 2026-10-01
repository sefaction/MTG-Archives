import { createHash } from "node:crypto";
import { z } from "zod";
import { printingNativeSchema } from "./acquisition-printing";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({
  version: z.literal(1), ownerPlayerId: z.string().min(1).max(100),
  photoDigest: digest, descriptor: digest, policy: z.string().min(1).max(80),
  scryfallIds: z.array(z.string().uuid()).max(12),
}).strict();
export function printingReuseIdentity(value: z.input<typeof requestSchema>) {
  const request = requestSchema.parse(value);
  if (new Set(request.scryfallIds).size !== request.scryfallIds.length)
    throw new Error("Repeated printing request identity");
  return {...request, key: createHash("sha256").update(JSON.stringify(request)).digest("hex")};
}
export type PrintingReuseIdentity = ReturnType<typeof printingReuseIdentity>;

const nativeIdentitySchema = z.object({
  descriptor: digest, photoDigest: digest, milliseconds: z.number().finite().nonnegative(),
});
export function checkedPrintingNative(raw: unknown, identity: PrintingReuseIdentity) {
  const native = printingNativeSchema.parse(raw);
  const provenance = nativeIdentitySchema.parse(raw);
  if (provenance.descriptor !== identity.descriptor || provenance.photoDigest !== identity.photoDigest ||
      native.candidates.some(c => !identity.scryfallIds.includes(c.scryfallId)))
    throw new Error("Printing processing identity changed");
  return {...native, ...provenance};
}

// Old jobs have no exact request envelope. Never infer their lineage from the
// proposals (which may have been reordered) or from the native returned subset.
export function reusablePrintingNative(output: unknown, identity: PrintingReuseIdentity) {
  try {
    if (Buffer.byteLength(JSON.stringify(output)) > 65536) return null;
    const record = z.object({printingReuse: requestSchema.extend({key: digest}), printingNative: z.unknown()}).parse(output);
    const {key, ...request} = record.printingReuse;
    const saved = printingReuseIdentity(request);
    if (saved.key !== record.printingReuse.key || saved.key !== identity.key) return null;
    return checkedPrintingNative(record.printingNative, identity);
  } catch { return null; }
}
