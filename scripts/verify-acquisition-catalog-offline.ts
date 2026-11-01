import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AcquisitionActor } from "../lib/acquisition-store";
import { beginAcquisitionCatalog, applyAcquisitionCatalogBatch, finishAcquisitionCatalog } from "../lib/acquisition-catalog";
import { inspectAcquisitionCatalogFile } from "../lib/acquisition-catalog-file";
import { buildOfflineAcquisitionCatalog, OFFLINE_CATALOG_BUILDING } from "../lib/acquisition-catalog-offline-index";
import { resolveOfflineAcquisitionCatalog } from "../lib/acquisition-catalog-offline-lookup";
import { offlineCatalogKey, offlineCatalogManifestSchema } from "../lib/acquisition-catalog-offline-family";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey, type CatalogQuery } from "../lib/acquisition-catalog-queries";
import { cardWriteData } from "../lib/card-import";
import type { ScryfallCard } from "../lib/scryfall";

export async function verifyAcquisitionCatalogOffline(db: PrismaClient, admin: AcquisitionActor, member: AcquisitionActor) {
  const tag = "offline-catalog-" + randomUUID(), title = tag + " Forest";
  const root = path.join(process.cwd(), ".local-data"); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, "offline-catalog-sql-")), file = path.join(folder, "source.gz");
  const cards: ScryfallCard[] = Array.from({ length: 130 }, (_, i) => ({
    object: "card", id: randomUUID(), name: i < 2 || i === 5 || i === 6 ? title : tag + " Card " + i,
    set: i === 1 ? "plst" : "tst", set_name: "Offline fixture", collector_number: i === 1 ? "TST-1a" : i === 0 ? "1a" : String(i + 1),
    rarity: "common", cmc: 0, color_identity: [], lang: i === 5 ? "fr" : "en", digital: i === 6, games: i === 6 ? ["arena"] : ["paper"],
    prices: { usd: "1.00" },
  }));
  cards[2] = { ...cards[2], name: title + " // " + tag + " Back", card_faces: [{ name: title }, { name: tag + " Back" }] };
  cards[3] = { ...cards[3], name: tag + " Growth" };
  cards[4] = { ...cards[4], name: tag + ", Growth" };
  const ids = cards.map(card => card.id), ordinaryKeys = new Set<string>();
  const query: CatalogQuery = { kind: "name", name: title };
  const ownInventoryId = tag + "-inventory", ownLocationId = tag + "-location";
  let refreshId: string | undefined, digest: string | undefined;
  let failed = false, primary: unknown, providerCalls = 0;
  const unavailable = async () => { providerCalls++; return { status: "PROVIDER_ERROR" as const, cards: [],
    requestsMade: 1, printingCoverage: "UNRESOLVED" as const, errorKind: "NETWORK" as const }; };
  const cached = (q: CatalogQuery) => { ordinaryKeys.add(catalogQueryKey(q)); return resolveCachedAcquisitionCatalog(db, q, AbortSignal.timeout(10000), unavailable); };
  const snapshotCached = (q: CatalogQuery) => { ordinaryKeys.add(catalogQueryKey(q)); return resolveCachedAcquisitionCatalog(
    db, q, AbortSignal.timeout(10000), unavailable, { preferCompleteSnapshot: true }); };
  const local = (q: CatalogQuery) => resolveOfflineAcquisitionCatalog(db, q, AbortSignal.timeout(10000));
  const cardState = () => db.card.findMany({ where: { scryfallId: { in: ids } }, orderBy: { scryfallId: "asc" } });
  const json = (value: unknown) => JSON.stringify(value);
  const writeCard = (card: ScryfallCard) => cardWriteData(card) as Omit<Prisma.CardCreateManyInput, "scryfallId">;
  try {
    await writeFile(file, gzipSync(cards.map(card => JSON.stringify(card)).join("\n") + "\n"));
    const inspected = await inspectAcquisitionCatalogFile(file); digest = inspected.digest;
    const source = { sourceDigest: digest, sourceType: "scryfall-default-jsonl-gzip-v1", sourceUpdatedAt: new Date().toISOString(),
      sourceBytes: inspected.bytes, expectedRows: inspected.rows };
    const refresh = await beginAcquisitionCatalog(db, admin, source); refreshId = refresh.id;
    await applyAcquisitionCatalogBatch(db, admin, refreshId, 0, cards.slice(0, 128));
    await assert.rejects(buildOfflineAcquisitionCatalog(db, admin, refreshId, file), /complete supported/);
    assert.equal(await local(query), undefined, "A partial bulk import cannot prove a family");
    await applyAcquisitionCatalogBatch(db, admin, refreshId, 128, cards.slice(128));
    await finishAcquisitionCatalog(db, admin, refreshId, digest);
    await assert.rejects(buildOfflineAcquisitionCatalog(db, member, refreshId, file), /administrator/);
    await assert.rejects(buildOfflineAcquisitionCatalog(db, { ...admin, adminMode: false }, refreshId, file), /administrator/);
    assert.equal(await local(query), undefined, "Legacy COMPLETE metadata without an index is not coverage");
    assert.equal((await cached(query)).status, "PROVIDER_ERROR"); assert.equal(providerCalls, 1);
    const unverified = await snapshotCached(query);
    assert.equal(unverified.status, "PROVIDER_ERROR", "Snapshot preference needs an actually verified index");
    assert.equal(unverified.sourceCoverage, undefined);
    const first = await db.card.findUniqueOrThrow({ where: { scryfallId: ids[0] } });
    await db.card.update({ where: { id: first.id }, data: {
      ...writeCard({ ...cards[0], prices: { usd: "9.99" } }),
      lastSyncedAt: new Date(Date.now() + 1000),
    } });
    const owner = await db.user.findUniqueOrThrow({ where: { id: member.userId }, select: { playerId: true } });
    assert.ok(owner.playerId);
    await db.inventoryLocation.create({ data: { id: ownLocationId, ownerPlayerId: owner.playerId,
      name: tag, normalizedName: tag, visibility: "PRIVATE" } });
    await db.inventoryItem.create({ data: { id: ownInventoryId, cardId: first.id, currentOwnerId: owner.playerId,
      originalOpenerId: owner.playerId, locationId: ownLocationId, quantity: 7, foilStatus: "NONFOIL",
      sourceType: "MANUAL", condition: "NM", language: "EN" } });
    const before = json(await cardState()), inventoryBefore = json(await db.inventoryItem.findUnique({ where: { id: ownInventoryId } }));
    const auditsBefore = await db.inventoryAuditLog.count();
    const markerKey = offlineCatalogKey("manifest", digest);
    const fault = db.$extends({ query: { acquisitionCatalogLookup: { async update({ args, query: execute }) {
      if (args.where.key === markerKey && args.data.result && typeof args.data.result === "object" &&
          "preparedRows" in args.data.result && Number(args.data.result.preparedRows) === 128)
        throw Error("injected offline cursor failure");
      return execute(args);
    } } } }) as unknown as PrismaClient;
    await assert.rejects(buildOfflineAcquisitionCatalog(fault, admin, refreshId, file), /injected offline cursor failure/);
    const afterFault = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: markerKey } });
    assert.equal(offlineCatalogManifestSchema.parse(afterFault.result).preparedRows, 0);
    assert.equal(await db.acquisitionCatalogLookup.count({ where: { request: { path: ["sourceDigest"], equals: digest } } }), 0,
      "Family rows roll back with the failed cursor transaction");
    await assert.rejects(buildOfflineAcquisitionCatalog(db, admin, refreshId, file, progress => {
      if (progress.preparedRows === 128) throw Error("declared index interruption");
    }), /declared index interruption/);
    const partial = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: markerKey } });
    assert.equal(partial.status, OFFLINE_CATALOG_BUILDING);
    assert.equal(offlineCatalogManifestSchema.parse(partial.result).preparedRows, 128);
    assert.equal(await local(query), undefined, "Staged families must remain unpublished");
    const resumed = await Promise.all([buildOfflineAcquisitionCatalog(db, admin, refreshId, file),
      buildOfflineAcquisitionCatalog(db, admin, refreshId, file)]);
    for (const result of resumed) { assert.equal(result.verified, true); assert.equal(result.preparedRows, 130); assert.equal(result.englishPaperRows, 128); }
    assert.equal((await buildOfflineAcquisitionCatalog(db, admin, refreshId, file)).reused, true);
    assert.equal(json(await cardState()), before, "Index build preserves every Card field and stable ID");
    assert.equal(json(await db.inventoryItem.findUnique({ where: { id: ownInventoryId } })), inventoryBefore);
    assert.equal(await db.inventoryAuditLog.count(), auditsBefore);
    const found = await cached(query); assert.equal(found.status, "FOUND"); assert.equal(providerCalls, 1);
    if (found.status !== "FOUND") throw Error("Expected offline family");
    assert.equal(found.requestsMade, 0); assert.equal(found.printingCoverage, "CHECKED");
    assert.equal(found.sourceCoverage?.sourceDigest, digest);
    assert.deepEqual(found.cards.map(card => card.id).sort(), ids.slice(0, 3).sort());
    for (const q of [{ kind: "name", name: tag + " Outside snapshot" },
      { kind: "name", name: title, fuzzy: true }] as CatalogQuery[]) {
      const unresolved = await snapshotCached(q);
      assert.equal(unresolved.status, "INCOMPLETE");
      assert.equal(unresolved.requestsMade, 0); assert.equal(unresolved.printingCoverage, "UNRESOLVED");
      assert.equal(unresolved.sourceCoverage?.sourceDigest, digest);
      assert.equal(await db.acquisitionCatalogLookup.findUnique({ where: { key: catalogQueryKey(q) } }), null,
        "Snapshot-only incomplete results do not publish a false negative or lease");
    }
    assert.equal(providerCalls, 1, "Complete English snapshot routing makes no unknown/fuzzy provider calls");
    for (const q of [{ kind: "id", id: ids[0] }, { kind: "printing", set: "tst", number: "0001a", language: "en" }] as CatalogQuery[])
      assert.deepEqual((await local(q))!.cards.map(card => card.id).sort(), ids.slice(0, 3).sort());
    assert.deepEqual((await local({ kind: "id", id: ids[2] }))!.cards.map(card => card.id), [ids[2]]);
    for (const i of [3, 4]) assert.deepEqual((await local({ kind: "name", name: cards[i].name }))!.cards.map(card => card.id), [ids[i]]);
    for (const q of [{ kind: "name", name: title, fuzzy: true }, { kind: "name", name: tag + " Unknown" },
      { kind: "printing", set: "tst", number: "6", language: "fr" }, { kind: "id", id: ids[5] }, { kind: "id", id: ids[6] }] as CatalogQuery[])
      assert.equal(await local(q), undefined);
    const originalVariant = await db.card.findUniqueOrThrow({ where: { scryfallId: ids[1] } });
    await db.card.update({ where: { id: originalVariant.id }, data: { rawScryfallJson: { ...cards[1], name: tag + " Changed" } as unknown as Prisma.InputJsonObject } });
    assert.equal(await local(query), undefined, "One changed member invalidates the full family");
    await db.card.update({ where: { id: originalVariant.id }, data: { rawScryfallJson: originalVariant.rawScryfallJson as Prisma.InputJsonValue } });
    await db.card.delete({ where: { id: originalVariant.id } });
    assert.equal(await local(query), undefined, "A removed member cannot create accidental uniqueness");
    assert.equal((await snapshotCached(query)).status, "INCOMPLETE",
      "An invalidated snapshot family stays explicitly incomplete without HTTP");
    assert.equal(providerCalls, 1);
    await db.card.create({ data: { ...writeCard(cards[1]), id: originalVariant.id, scryfallId: ids[1] } });
    assert.equal((await local(query))!.cards.length, 3);
    const marker = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: markerKey } });
    const complete = offlineCatalogManifestSchema.parse(marker.result);
    await db.acquisitionCatalogLookup.update({ where: { key: markerKey }, data: { result: { ...complete, preparedRows: 129 } } });
    assert.equal(await local(query), undefined, "Contradictory READY metadata is refused");
    await db.acquisitionCatalogLookup.update({ where: { key: markerKey }, data: { result: complete } });
    const cooldownQuery: CatalogQuery = { kind: "name", name: tag + " Block" }, cooldownKey = catalogQueryKey(cooldownQuery); ordinaryKeys.add(cooldownKey);
    await db.acquisitionCatalogLookup.create({ data: { key: cooldownKey, request: cooldownQuery, status: "PROVIDER_ERROR",
      expiresAt: new Date(Date.now() + 60000), result: { status: "PROVIDER_ERROR", ids: [], requestsMade: 1,
        printingCoverage: "UNRESOLVED", errorKind: "RATE_LIMITED", httpStatus: 429 } } });
    assert.equal((await cached(query)).status, "FOUND");
    const blocked = await cached({ kind: "name", name: tag + " Unknown" });
    assert.equal(blocked.status, "PROVIDER_ERROR"); assert.equal(providerCalls, 1);
    const additional = { ...cards[0], id: randomUUID(), set: "new", collector_number: "999" }; ids.push(additional.id);
    await db.card.create({ data: { ...writeCard(additional), scryfallId: additional.id } });
    await db.acquisitionCatalogLookup.update({ where: { key: catalogQueryKey(query) }, data: { status: "FOUND",
      expiresAt: new Date(Date.now() + 60000), result: { status: "FOUND", ids: [...ids.slice(0, 3), additional.id],
        requestsMade: 2, printingCoverage: "CHECKED" } } });
    const fresher = await cached(query); assert.equal(fresher.status, "FOUND");
    if (fresher.status !== "FOUND") throw Error("Expected fresher provider cache");
    assert.equal(fresher.cards.length, 4); assert.equal(fresher.sourceCoverage, undefined); assert.equal(providerCalls, 1);
    assert.equal((await db.card.findUniqueOrThrow({ where: { scryfallId: ids[0] } })).id, first.id);
    assert.equal(json(await db.inventoryItem.findUnique({ where: { id: ownInventoryId } })), inventoryBefore);
    assert.equal(await db.inventoryAuditLog.count(), auditsBefore);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(resolveOfflineAcquisitionCatalog(db, query, aborted.signal));
    await db.acquisitionCatalogLookup.delete({ where: { key: cooldownKey } });
    const onlineQuery: CatalogQuery = { kind: "name", name: tag + " New online card" };
    const callsBeforeOnline = providerCalls;
    assert.equal((await cached(onlineQuery)).status, "PROVIDER_ERROR");
    assert.equal(providerCalls, callsBeforeOnline + 1, "Explicit positive-only callers retain online new-card admission");
    const networkBefore = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: catalogQueryKey(onlineQuery) } });
    const offlineUnknown = await snapshotCached(onlineQuery);
    assert.equal(offlineUnknown.status, "INCOMPLETE");
    assert.equal(providerCalls, callsBeforeOnline + 1);
    assert.deepEqual(await db.acquisitionCatalogLookup.findUnique({ where: { key: catalogQueryKey(onlineQuery) } }), networkBefore,
      "Choosing dated incomplete snapshot evidence never erases recorded provider failure/backoff");
    const foreign: CatalogQuery = { kind: "printing", set: "tst", number: "6", language: "fr" };
    assert.equal((await snapshotCached(foreign)).status, "INCOMPLETE");
    assert.equal(providerCalls, callsBeforeOnline + 1, "Snapshot-only mode cannot invent foreign coverage or make a hidden live request");
    assert.equal((await cached(foreign)).status, "PROVIDER_ERROR");
    assert.equal(providerCalls, callsBeforeOnline + 2, "Unsupported foreign scope keeps its explicit provider path");
    assert.equal((await cached({ kind: "name", name: tag + " Online fuzzy", fuzzy: true })).status, "PROVIDER_ERROR");
    assert.equal(providerCalls, callsBeforeOnline + 3, "Explicit fuzzy callers retain their provider path");
  } catch (error) { failed = true; primary = error; }
  const cleanup: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { cleanup.push(error); } };
  await attempt(() => db.inventoryItem.deleteMany({ where: { id: ownInventoryId } }));
  await attempt(() => db.inventoryLocation.deleteMany({ where: { id: ownLocationId } }));
  await attempt(() => db.acquisitionCatalogLookup.deleteMany({ where: { OR: [
    { key: { in: [...ordinaryKeys, ...(digest ? [offlineCatalogKey("manifest", digest)] : [])] } },
    ...(digest ? [{ request: { path: ["sourceDigest"], equals: digest } }] : []),
  ] } }));
  await attempt(() => db.card.deleteMany({ where: { scryfallId: { in: ids } } }));
  if (refreshId) await attempt(() => db.acquisitionCatalogRefresh.deleteMany({ where: { id: refreshId } }));
  await attempt(() => unlink(file)); await attempt(() => rmdir(folder));
  if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], "Offline catalogue verification/cleanup failed");
  if (failed) throw primary;
  console.log("PASS: actual offline family publication, rollback, interruption/concurrent resume, exact aliases/languages/punctuation, missing/changed members, prices/IDs/Inventory, snapshot-only incomplete routing and explicit online/foreign/fuzzy cache/backoff");
}
