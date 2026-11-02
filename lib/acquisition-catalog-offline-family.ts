import { createHash } from "node:crypto";
import { z } from "zod";
import { acquisitionCatalogCardSchema } from "./acquisition-catalog";
import { acquisitionCollectorKey } from "./acquisition-footer";

export const OFFLINE_CATALOG_INDEX_VERSION = 1;
export const OFFLINE_CATALOG_SOURCE_TYPE = "scryfall-default-jsonl-gzip-v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
export const offlineCatalogMemberSchema = z.object({ id: uuid, identity: digest }).strict();
export type OfflineCatalogMember = z.infer<typeof offlineCatalogMemberSchema>;
export const offlineCatalogManifestSchema = z.object({
  version: z.literal(OFFLINE_CATALOG_INDEX_VERSION), generation: uuid,
  refreshId: uuid, sourceDigest: digest,
  sourceType: z.literal(OFFLINE_CATALOG_SOURCE_TYPE),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  sourceBytes: z.string().regex(/^[1-9]\d*$/).refine(value => BigInt(value) <= 1024n ** 3n),
  expectedRows: z.number().int().positive().max(2000000),
  preparedRows: z.number().int().nonnegative().max(2000000),
  englishPaperRows: z.number().int().nonnegative().max(2000000),
  verified: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.preparedRows > value.expectedRows || value.englishPaperRows > value.preparedRows ||
      (value.verified && value.preparedRows !== value.expectedRows))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Offline source cursor is incomplete or contradictory" });
});
export type OfflineCatalogManifest = z.infer<typeof offlineCatalogManifestSchema>;
export const offlineCatalogFamilySchema = z.object({
  version: z.literal(OFFLINE_CATALOG_INDEX_VERSION),
  sourceDigest: digest,
  generation: uuid,
  name: z.string().min(1).max(500),
  members: z.array(offlineCatalogMemberSchema).min(1).max(20000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.members.map(member => member.id)).size !== value.members.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Repeated offline printing identity" });
});
export const offlineCatalogPrintingSchema = z.object({
  version: z.literal(OFFLINE_CATALOG_INDEX_VERSION), sourceDigest: digest,
  generation: uuid, set: z.string().min(1).max(30), number: z.string().min(1).max(100),
  language: z.literal("en"), members: z.array(offlineCatalogMemberSchema).min(1).max(20000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.members.map(member => member.id)).size !== value.members.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Repeated offline printing locator identity" });
});

export function offlineCatalogName(name: string) {
  return z.string().min(1).max(500).parse(name).normalize("NFKC").toLowerCase();
}

export function offlineCatalogKey(
  kind: "manifest" | "family",
  sourceDigest: string,
  generation?: string,
  name?: string,
) {
  z.enum(["manifest", "family"]).parse(kind);
  digest.parse(sourceDigest);
  if (kind === "family") { uuid.parse(generation); z.string().min(1).max(500).parse(name); }
  else if (generation !== undefined || name !== undefined) throw Error("Manifest cannot name a family");
  return createHash("sha256").update(JSON.stringify({
    kind: "offline-catalog-" + kind,
    version: OFFLINE_CATALOG_INDEX_VERSION,
    sourceDigest,
    ...(kind === "family" ? { generation, name: offlineCatalogName(name!) } : {}),
  })).digest("hex");
}

export function offlineCatalogPrintingKey(sourceDigest: string, generation: string, set: string, number: string) {
  digest.parse(sourceDigest); uuid.parse(generation);
  z.string().min(1).max(30).parse(set); z.string().min(1).max(100).parse(number);
  return createHash("sha256").update(JSON.stringify({ kind: "offline-catalog-printing",
    version: OFFLINE_CATALOG_INDEX_VERSION, sourceDigest, generation,
    set: set.toLowerCase(), number: acquisitionCollectorKey(number), language: "en",
  })).digest("hex");
}

// Default data establishes English printing coverage. A foreign card or digital
// entry is not evidence of an English paper family, even when it shares art.
export function offlineCatalogIdentity(raw: unknown) {
  const card = acquisitionCatalogCardSchema.parse(raw);
  if (card.lang !== "en") return null;
  const identity = z.object({
    digital: z.boolean(), games: z.array(z.string().min(1).max(30)).max(20),
    card_faces: z.array(z.object({ name: z.string().min(1).max(500) }).passthrough()).max(10).optional(),
  }).passthrough().parse(card);
  if (identity.digital || !identity.games.includes("paper")) return null;
  const names = [...new Set([card.name, ...(identity.card_faces ?? []).map(face => face.name)])];
  const signature = createHash("sha256").update(JSON.stringify({
    id: card.id, name: card.name, set: card.set, number: card.collector_number,
    language: card.lang, paper: true, faces: (identity.card_faces ?? []).map(face => face.name),
  })).digest("hex");
  return { id: card.id, identity: signature, names, set: card.set, number: card.collector_number, language: "en" as const };
}

export function mergeOfflineCatalogMembers(
  previous: OfflineCatalogMember[], incoming: OfflineCatalogMember[],
) {
  const members = new Map<string, OfflineCatalogMember>();
  for (const raw of [...previous, ...incoming]) {
    const member = offlineCatalogMemberSchema.parse(raw);
    const existing = members.get(member.id);
    if (existing && existing.identity !== member.identity) throw Error("Offline printing identity changed");
    members.set(member.id, member);
  }
  if (!members.size || members.size > 20000) throw Error("Offline printing family exceeds coverage bound");
  return [...members.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
