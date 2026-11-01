import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { catalogQuerySchema, type CatalogQuery } from "./acquisition-catalog-queries";
import { acquisitionCollectorKey } from "./acquisition-footer";
import type { ScryfallCard } from "./scryfall";
import {
  OFFLINE_CATALOG_SOURCE_TYPE, OFFLINE_CATALOG_INDEX_VERSION,
  offlineCatalogKey, offlineCatalogPrintingKey, offlineCatalogName, offlineCatalogIdentity,
  offlineCatalogManifestSchema, offlineCatalogFamilySchema, offlineCatalogPrintingSchema,
  type OfflineCatalogMember,
} from "./acquisition-catalog-offline-family";
import { assertOfflineCatalogSource, OFFLINE_CATALOG_READY, OFFLINE_CATALOG_STAGED } from "./acquisition-catalog-offline-index";

export type OfflineCatalogCoverage = {
  kind: "BULK_SNAPSHOT"; version: 1; sourceDigest: string; sourceUpdatedAt: string; language: "en";
};

function currentIdentity(raw: unknown) {
  try { return offlineCatalogIdentity(raw); }
  catch (error) { if (error instanceof z.ZodError) return null; throw error; }
}

// Positive coverage only. Unknown/fuzzy/foreign requests retain their existing
// provider path; an incomplete source or missing family never proves absence.
export async function resolveOfflineAcquisitionCatalog(
  db: PrismaClient, raw: CatalogQuery, signal: AbortSignal,
): Promise<{ cards: ScryfallCard[]; sourceCoverage: OfflineCatalogCoverage } | undefined> {
  const query = catalogQuerySchema.parse(raw);
  signal.throwIfAborted();
  if ((query.kind === "name" && query.fuzzy) || (query.kind === "printing" && query.language !== "en")) return undefined;
  return db.$transaction(async tx => {
    signal.throwIfAborted();
    const source = await tx.acquisitionCatalogRefresh.findFirst({
      where: { status: "COMPLETE", sourceType: OFFLINE_CATALOG_SOURCE_TYPE },
      orderBy: [{ sourceUpdatedAt: "desc" }, { completedAt: "desc" }, { id: "desc" }],
    });
    if (!source) return undefined;
    const marker = await tx.acquisitionCatalogLookup.findUnique({
      where: { key: offlineCatalogKey("manifest", source.sourceDigest) },
    });
    if (!marker || marker.status !== OFFLINE_CATALOG_READY) return undefined;
    const parsed = offlineCatalogManifestSchema.safeParse(marker.result);
    if (!parsed.success || !parsed.data.verified) return undefined;
    const manifest = parsed.data;
    try { assertOfflineCatalogSource(manifest, source); } catch { return undefined; }
    const request = z.object({ kind: z.literal("offline-catalog-source"),
      version: z.literal(OFFLINE_CATALOG_INDEX_VERSION), refreshId: z.literal(source.id) }).strict().safeParse(marker.request);
    if (!request.success) return undefined;
    signal.throwIfAborted();
    let names: string[];
    let base: OfflineCatalogMember[] = [];
    if (query.kind === "name") names = [offlineCatalogName(query.name)];
    else {
      if (query.kind === "id") {
        const card = await tx.card.findUnique({ where: { scryfallId: query.id }, select: { rawScryfallJson: true } });
        const identity = card ? currentIdentity(card.rawScryfallJson) : null;
        if (!identity || identity.id !== query.id) return undefined;
        base = [{ id: identity.id, identity: identity.identity }];
      } else {
        const locator = await tx.acquisitionCatalogLookup.findUnique({
          where: { key: offlineCatalogPrintingKey(manifest.sourceDigest, manifest.generation, query.set, query.number) },
        });
        if (!locator || locator.status !== OFFLINE_CATALOG_STAGED) return undefined;
        const value = offlineCatalogPrintingSchema.safeParse(locator.result);
        if (!value.success || value.data.sourceDigest !== manifest.sourceDigest || value.data.generation !== manifest.generation ||
            value.data.set !== query.set || value.data.number !== acquisitionCollectorKey(query.number)) return undefined;
        base = value.data.members;
      }
      const rows = await tx.card.findMany({ where: { scryfallId: { in: base.map(member => member.id) } },
        select: { scryfallId: true, rawScryfallJson: true } });
      if (rows.length !== base.length) return undefined;
      const identities = rows.map(row => currentIdentity(row.rawScryfallJson));
      const baseById = new Map(base.map(member => [member.id, member]));
      for (let i = 0; i < rows.length; i++) {
        const identity = identities[i], expected = rows[i].scryfallId ? baseById.get(rows[i].scryfallId!) : undefined;
        if (!identity || identity.id !== rows[i].scryfallId || !expected || identity.identity !== expected.identity) return undefined;
        if (query.kind === "printing" && (identity.set.toLowerCase() !== query.set ||
            acquisitionCollectorKey(identity.number) !== acquisitionCollectorKey(query.number))) return undefined;
      }
      names = [...new Set(identities.map(identity => offlineCatalogName(identity!.names[0])))];
    }
    const keys = names.map(name => offlineCatalogKey("family", manifest.sourceDigest, manifest.generation, name));
    const nameByKey = new Map(keys.map((key, i) => [key, names[i]]));
    const families = await tx.acquisitionCatalogLookup.findMany({ where: { key: { in: keys } } });
    if (families.length !== keys.length) return undefined;
    const members = new Map<string, OfflineCatalogMember>();
    const requiredNames = new Map<string, Set<string>>();
    for (const row of families) {
      const name = nameByKey.get(row.key), family = offlineCatalogFamilySchema.safeParse(row.result);
      if (!name || row.status !== OFFLINE_CATALOG_STAGED || !family.success || family.data.name !== name ||
          family.data.sourceDigest !== manifest.sourceDigest || family.data.generation !== manifest.generation) return undefined;
      for (const member of family.data.members) {
        const previous = members.get(member.id);
        if (previous && previous.identity !== member.identity) return undefined;
        members.set(member.id, member);
        const aliases = requiredNames.get(member.id) ?? new Set<string>(); aliases.add(name); requiredNames.set(member.id, aliases);
      }
    }
    if (!members.size || members.size > 20000 || base.some(member => members.get(member.id)?.identity !== member.identity)) return undefined;
    const rows = await tx.card.findMany({ where: { scryfallId: { in: [...members.keys()] } },
      select: { scryfallId: true, rawScryfallJson: true } });
    if (rows.length !== members.size) return undefined;
    const cards: ScryfallCard[] = [];
    for (const row of rows) {
      const identity = currentIdentity(row.rawScryfallJson), expected = row.scryfallId ? members.get(row.scryfallId) : undefined;
      if (!identity || !expected || identity.id !== row.scryfallId || identity.identity !== expected.identity) return undefined;
      const aliases = new Set(identity.names.map(offlineCatalogName));
      if ([...requiredNames.get(identity.id)!].some(name => !aliases.has(name))) return undefined;
      cards.push(row.rawScryfallJson as unknown as ScryfallCard);
    }
    signal.throwIfAborted();
    return { cards, sourceCoverage: { kind: "BULK_SNAPSHOT" as const, version: 1 as const,
      sourceDigest: manifest.sourceDigest, sourceUpdatedAt: manifest.sourceUpdatedAt, language: "en" as const } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 60000 });
}
