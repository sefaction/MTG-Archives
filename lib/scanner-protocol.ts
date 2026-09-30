import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SCANNER_PROTOCOL = 1;
export const scannerDeviceSchema = z.object({
  id: z.string().min(1).max(256), name: z.string().min(1).max(160),
  backend: z.string().min(1).max(64), source: z.string().min(1).max(64),
  qualification: z.enum(["Qualified", "KnownWorking", "GenericUnqualified", "Unsupported"]),
}).strict();
export const scannerPulseSchema = z.object({
  version: z.literal(SCANNER_PROTOCOL),
  agentVersion: z.string().min(1).max(64),
  devices: z.array(scannerDeviceSchema).max(32),
}).strict().refine(p => new Set(p.devices.map(d => d.id)).size === p.devices.length,
  "Duplicate scanner identity");
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const scannerPairClaimSchema = z.object({
  version: z.literal(SCANNER_PROTOCOL), pairCode: z.string().max(100),
  agentId: z.string().uuid(), secret, name: z.string().trim().min(1).max(80),
}).strict();
export function scannerSecret() { return randomBytes(32).toString("base64url"); }
export function scannerHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function scannerHashMatches(value: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(scannerHash(value), "hex"), Buffer.from(hash, "hex"));
}
export function scannerCredential(value?: string | null) {
  if (!value?.startsWith("Bearer ")) return null;
  const parts = value.slice(7).split(".");
  return parts.length === 2 && z.string().uuid().safeParse(parts[0]).success &&
    secret.safeParse(parts[1]).success ? { id: parts[0], secret: parts[1] } : null;
}
export function scannerPairCode(value: string) {
  const parts = value.split(".");
  if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success ||
    !secret.safeParse(parts[1]).success) throw new Error("Scanner connection unavailable");
  return { id: parts[0], secret: parts[1] };
}
