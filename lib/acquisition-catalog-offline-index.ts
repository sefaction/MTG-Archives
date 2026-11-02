import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type AcquisitionCatalogRefresh } from "@prisma/client";
import { z } from "zod";
import type { AcquisitionActor } from "./acquisition-store";
import { acquisitionCatalogCardSchema, withAcquisitionCatalogMaintenance } from "./acquisition-catalog";
import { readAcquisitionCatalogFile } from "./acquisition-catalog-file";
import { acquisitionCollectorKey } from "./acquisition-footer";
import {
  OFFLINE_CATALOG_INDEX_VERSION, OFFLINE_CATALOG_SOURCE_TYPE,
  offlineCatalogManifestSchema, offlineCatalogFamilySchema, offlineCatalogPrintingSchema,
  offlineCatalogKey, offlineCatalogPrintingKey, offlineCatalogName,
  offlineCatalogIdentity, mergeOfflineCatalogMembers,
  type OfflineCatalogManifest, type OfflineCatalogMember,
} from "./acquisition-catalog-offline-family";

export const OFFLINE_CATALOG_BUILDING = "OFFLINE_CATALOG_BUILDING";
export const OFFLINE_CATALOG_READY = "OFFLINE_CATALOG_READY";
export const OFFLINE_CATALOG_STAGED = "OFFLINE_CATALOG_STAGED";

export function offlineCatalogSource(refresh: AcquisitionCatalogRefresh) {
  if (refresh.status !== "COMPLETE" || !refresh.completedAt ||
      refresh.sourceType !== OFFLINE_CATALOG_SOURCE_TYPE || refresh.processedRows !== refresh.expectedRows)
    throw Error("Offline coverage requires a complete supported catalogue source");
  return {
    refreshId: refresh.id, sourceDigest: refresh.sourceDigest, sourceType: refresh.sourceType,
    sourceUpdatedAt: refresh.sourceUpdatedAt.toISOString(), sourceBytes: refresh.sourceBytes.toString(),
    expectedRows: refresh.expectedRows,
  };
}

export function assertOfflineCatalogSource(manifest: OfflineCatalogManifest, refresh: AcquisitionCatalogRefresh) {
  const source = offlineCatalogSource(refresh);
  for (const key of Object.keys(source) as (keyof typeof source)[])
    if (manifest[key] !== source[key]) throw Error("Offline catalogue source identity changed");
}

async function readBuild(tx: Prisma.TransactionClient, refreshId: string, generation?: string) {
  const refresh = await tx.acquisitionCatalogRefresh.findUniqueOrThrow({ where: { id: refreshId } });
  const source = offlineCatalogSource(refresh);
  const key = offlineCatalogKey("manifest", source.sourceDigest);
  const row = await tx.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key } });
  const manifest = offlineCatalogManifestSchema.parse(row.result);
  assertOfflineCatalogSource(manifest, refresh);
  const request = z.object({ kind: z.literal("offline-catalog-source"),
    version: z.literal(OFFLINE_CATALOG_INDEX_VERSION), refreshId: z.literal(refreshId) }).strict().parse(row.request);
  if (!request || ![OFFLINE_CATALOG_BUILDING, OFFLINE_CATALOG_READY].includes(row.status) ||
      (generation !== undefined && manifest.generation !== generation) ||
      ((row.status === OFFLINE_CATALOG_READY) !== manifest.verified))
    throw Error("Offline catalogue generation or publication state changed");
  return { refresh, key, row, manifest };
}

async function beginIndex(db: PrismaClient, actor: AcquisitionActor, refreshId: string) {
  return withAcquisitionCatalogMaintenance(db, actor, async tx => {
    const refresh = await tx.acquisitionCatalogRefresh.findUniqueOrThrow({ where: { id: refreshId } });
    const source = offlineCatalogSource(refresh);
    const key = offlineCatalogKey("manifest", source.sourceDigest);
    const existing = await tx.acquisitionCatalogLookup.findUnique({ where: { key } });
    if (!existing) {
      const manifest = offlineCatalogManifestSchema.parse({ ...source, version: OFFLINE_CATALOG_INDEX_VERSION,
        generation: randomUUID(), preparedRows: 0, englishPaperRows: 0, verified: false });
      await tx.acquisitionCatalogLookup.create({ data: { key, status: OFFLINE_CATALOG_BUILDING,
        request: { kind: "offline-catalog-source", version: OFFLINE_CATALOG_INDEX_VERSION, refreshId },
        result: manifest } });
    }
    return readBuild(tx, refreshId);
  });
}

async function applyIndexBatch(
  db: PrismaClient, actor: AcquisitionActor, refreshId: string, generation: string,
  offset: number, rawCards: unknown[],
) {
  z.number().int().nonnegative().parse(offset);
  const cards = z.array(acquisitionCatalogCardSchema).min(1).max(128).parse(rawCards);
  if (new Set(cards.map(card => card.id)).size !== cards.length) throw Error("Repeated source identity in index batch");
  return withAcquisitionCatalogMaintenance(db, actor, async tx => {
    const state = await readBuild(tx, refreshId, generation), manifest = state.manifest;
    // The builder owns a fully verified compressed snapshot before its first
    // record. Replayed prefixes therefore belong to this exact source digest.
    if (offset + cards.length <= manifest.preparedRows) return manifest;
    if (state.row.status !== OFFLINE_CATALOG_BUILDING || offset !== manifest.preparedRows ||
        offset + cards.length > manifest.expectedRows) throw Error("Offline index cursor changed");
    const indexed = cards.map(offlineCatalogIdentity).filter((card): card is NonNullable<typeof card> => card !== null);
    const current = indexed.length ? await tx.card.findMany({
      where: { scryfallId: { in: indexed.map(card => card.id) } },
      select: { scryfallId: true, rawScryfallJson: true },
    }) : [];
    const currentById = new Map(current.map(card => [card.scryfallId, card]));
    for (const card of indexed) {
      const present = currentById.get(card.id);
      if (!present || offlineCatalogIdentity(present.rawScryfallJson)?.identity !== card.identity)
        throw Error("Loaded card is missing or differs from the indexed source");
    }
    const families = new Map<string, OfflineCatalogMember[]>();
    const printings = new Map<string, { set: string; number: string; members: OfflineCatalogMember[] }>();
    for (const card of indexed) {
      const member = { id: card.id, identity: card.identity };
      for (const name of new Set(card.names.map(offlineCatalogName)))
        families.set(name, [...(families.get(name) ?? []), member]);
      const key = offlineCatalogPrintingKey(manifest.sourceDigest, generation, card.set, card.number);
      const entry = printings.get(key) ?? { set: card.set.toLowerCase(), number: acquisitionCollectorKey(card.number), members: [] };
      entry.members.push(member); printings.set(key, entry);
    }
    for (const [name, incoming] of families) {
      const key = offlineCatalogKey("family", manifest.sourceDigest, generation, name);
      const existing = await tx.acquisitionCatalogLookup.findUnique({ where: { key } });
      const previous = existing ? offlineCatalogFamilySchema.parse(existing.result) : undefined;
      if (existing && (existing.status !== OFFLINE_CATALOG_STAGED || previous!.sourceDigest !== manifest.sourceDigest ||
          previous!.generation !== generation || previous!.name !== name)) throw Error("Offline family identity changed");
      const result = offlineCatalogFamilySchema.parse({ version: OFFLINE_CATALOG_INDEX_VERSION,
        sourceDigest: manifest.sourceDigest, generation, name,
        members: mergeOfflineCatalogMembers(previous?.members ?? [], incoming) });
      const request = { kind: "offline-catalog-family", version: OFFLINE_CATALOG_INDEX_VERSION,
        sourceDigest: manifest.sourceDigest, generation, name };
      await tx.acquisitionCatalogLookup.upsert({ where: { key }, create: { key, status: OFFLINE_CATALOG_STAGED, request, result },
        update: { status: OFFLINE_CATALOG_STAGED, request, result, leaseToken: null, leaseExpiresAt: null, expiresAt: null } });
    }
    for (const [key, incoming] of printings) {
      const existing = await tx.acquisitionCatalogLookup.findUnique({ where: { key } });
      const previous = existing ? offlineCatalogPrintingSchema.parse(existing.result) : undefined;
      if (existing && (existing.status !== OFFLINE_CATALOG_STAGED || previous!.sourceDigest !== manifest.sourceDigest ||
          previous!.generation !== generation || previous!.set !== incoming.set || previous!.number !== incoming.number))
        throw Error("Offline printing locator changed");
      const result = offlineCatalogPrintingSchema.parse({ version: OFFLINE_CATALOG_INDEX_VERSION,
        sourceDigest: manifest.sourceDigest, generation, set: incoming.set, number: incoming.number, language: "en",
        members: mergeOfflineCatalogMembers(previous?.members ?? [], incoming.members) });
      const request = { kind: "offline-catalog-printing", version: OFFLINE_CATALOG_INDEX_VERSION,
        sourceDigest: manifest.sourceDigest, generation, set: incoming.set, number: incoming.number, language: "en" };
      await tx.acquisitionCatalogLookup.upsert({ where: { key }, create: { key, status: OFFLINE_CATALOG_STAGED, request, result },
        update: { status: OFFLINE_CATALOG_STAGED, request, result, leaseToken: null, leaseExpiresAt: null, expiresAt: null } });
    }
    const next = offlineCatalogManifestSchema.parse({ ...manifest,
      preparedRows: offset + cards.length, englishPaperRows: manifest.englishPaperRows + indexed.length });
    await tx.acquisitionCatalogLookup.update({ where: { key: state.key }, data: { result: next } });
    return next;
  });
}

export async function buildOfflineAcquisitionCatalog(
  db: PrismaClient, actor: AcquisitionActor, refreshId: string, file: string,
  onProgress?: (progress: { preparedRows: number; expectedRows: number }) => void | Promise<void>,
) {
  const initial = await beginIndex(db, actor, refreshId), manifest = initial.manifest;
  if (manifest.verified) return { ...manifest, reused: true };
  const seen = new Set<string>();
  let rows = 0, batch: unknown[] = [], offset = 0;
  const apply = async () => {
    const next = await applyIndexBatch(db, actor, refreshId, manifest.generation, offset, batch);
    batch = [];
    await onProgress?.({ preparedRows: next.preparedRows, expectedRows: next.expectedRows });
  };
  for await (const card of readAcquisitionCatalogFile(file, {
    digest: manifest.sourceDigest, bytes: Number(manifest.sourceBytes),
  })) {
    if (seen.has(card.id)) throw Error("Repeated source identity in offline index");
    seen.add(card.id);
    if (++rows > manifest.expectedRows) throw Error("Offline source exceeds declared row count");
    if (rows <= manifest.preparedRows) continue;
    if (!batch.length) offset = rows - 1;
    batch.push(card);
    if (batch.length === 128) await apply();
  }
  if (batch.length) await apply();
  if (rows !== manifest.expectedRows) throw Error("Offline source row count is incomplete");
  return withAcquisitionCatalogMaintenance(db, actor, async tx => {
    const state = await readBuild(tx, refreshId, manifest.generation);
    if (state.manifest.preparedRows !== rows) throw Error("Offline source cursor is incomplete");
    const complete = offlineCatalogManifestSchema.parse({ ...state.manifest, verified: true });
    await tx.acquisitionCatalogLookup.update({ where: { key: state.key }, data: {
      status: OFFLINE_CATALOG_READY, result: complete, leaseToken: null, leaseExpiresAt: null, expiresAt: null,
    } });
    return { ...complete, reused: false };
  });
}
