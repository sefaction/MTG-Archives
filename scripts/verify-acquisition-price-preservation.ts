import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { cardWriteData, scryfallFingerprint } from "../lib/card-import";
import { beginAcquisitionCatalog, applyAcquisitionCatalogBatch } from "../lib/acquisition-catalog";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import type { AcquisitionActor } from "../lib/acquisition-store";
import type { ScryfallCard } from "../lib/scryfall";

// Called with an owned administrator by the disposable acquisition SQL suite.
// No external provider is used: the callback returns only synthetic metadata.
export async function verifyAcquisitionPricePreservation(
  db: PrismaClient,
  admin: AcquisitionActor,
  writer: "bulk" | "cache",
) {
  const id = randomUUID(), secondId = randomUUID();
  const keys: string[] = [], refreshes: string[] = [];
  const mapping = randomUUID();
  const mtgjson = { tcgplayer: { normal: { retail: { USD: { amount: 5.75, observedDate: "2026-10-18" } } } } };
  const payload: ScryfallCard = {
    object: "card", id, name: `Owned ${writer} price fixture ${id}`,
    set: "tst", set_name: "Test fixture", collector_number: "1",
    rarity: "common", lang: "en", cmc: 1, color_identity: [],
    type_line: "Sorcery", prices: { usd: "3.00" },
  };
  let sequence = 0;
  async function prepare(card: ScryfallCard) {
    const unique = `${writer}-${id}-${++sequence}`;
    if (writer === "bulk") {
      const run = await beginAcquisitionCatalog(db, admin, {
        sourceDigest: createHash("sha256").update(unique).digest("hex"),
        sourceType: "scryfall-default-jsonl-gzip-v1", sourceUpdatedAt: "2021-01-01T00:00:00Z",
        sourceBytes: 1000, expectedRows: 1,
      });
      refreshes.push(run.id);
      return { runId: run.id, write: () => applyAcquisitionCatalogBatch(db, admin, run.id, 0, [card]) };
    }
    const query = { kind: "name" as const, name: unique };
    const key = catalogQueryKey(query); keys.push(key);
    return { key, write: () => resolveCachedAcquisitionCatalog(db, query, AbortSignal.timeout(30000), async () => ({
      status: "FOUND", cards: [card], requestsMade: 0, printingCoverage: "CHECKED",
    })) };
  }
  let cardId = "";
  let inventoryId = "";
  async function seed(prices: object | null = { usd: "1.00", obsolete_price: "remove", mtgjson }) {
    await db.card.update({ where: { id: cardId }, data: {
      prices: prices === null ? Prisma.DbNull : prices,
      lastSyncedAt: new Date("2000-01-01"), scryfallFingerprint: `old-${sequence}`,
      priceLastFetchedAt: new Date("2000-02-01"),
    } });
    return db.card.findUniqueOrThrow({ where: { id: cardId } });
  }
  const read = () => db.card.findUniqueOrThrow({ where: { id: cardId } });
  const trigger = `price_guard_${randomUUID().replaceAll("-", "")}`;
  let triggerCreated = false;
  try {
    const created = await db.card.create({ data: { ...cardWriteData(payload), scryfallId: id, mtgjsonUuid: mapping, firstCachedAt: new Date("1999-01-01") } as Prisma.CardCreateInput });
    cardId = created.id;
    const owner = await db.user.findUniqueOrThrow({ where: { id: admin.userId } });
    assert.ok(owner.playerId);
    const inventory = await db.inventoryItem.create({ data: {
      cardId, currentOwnerId: owner.playerId, quantity: 7, condition: "LP", sourceType: "MANUAL",
    } });
    inventoryId = inventory.id;
    const original = await seed();
    const incoming = { ...payload, prices: { usd: "4.00", eur: null, mtgjson: { stale: true } } } as unknown as ScryfallCard;
    const inputJSON = JSON.stringify(incoming);
    await (await prepare(incoming)).write();
    assert.deepEqual((await read()).prices, { usd: "4.00", eur: null, mtgjson }, `${writer} must preserve the current MTGJSON projection`);
    assert.equal(JSON.stringify(incoming), inputJSON, "Caller payload is immutable");
    const updated = await read();
    assert.equal(updated.id, original.id); assert.equal(updated.mtgjsonUuid, mapping);
    assert.deepEqual(updated.firstCachedAt, original.firstCachedAt);
    assert.ok(updated.priceLastFetchedAt! > original.priceLastFetchedAt!);

    for (const prices of [undefined, null, {}]) {
      const before = await seed();
      await (await prepare({ ...payload, prices } as ScryfallCard)).write();
      const after = await read();
      assert.deepEqual(after.prices, prices ? { mtgjson } : before.prices);
      if (!prices) assert.deepEqual(after.priceLastFetchedAt, before.priceLastFetchedAt);
    }
    await seed({ usd: "1.00", mtgjson: null });
    await (await prepare(payload)).write();
    assert.deepEqual((await read()).prices, { usd: "3.00", mtgjson: null });
    await seed(null);
    await (await prepare(payload)).write();
    assert.deepEqual((await read()).prices, { usd: "3.00" });

    await (await prepare({ ...incoming, id: secondId })).write();
    assert.deepEqual((await db.card.findUniqueOrThrow({ where: { scryfallId: secondId } })).prices, { usd: "4.00", eur: null }, "New cards cannot invent a Pricing projection");

    for (const fence of ["same-fingerprint", "newer-metadata"]) {
      await seed();
      await db.card.update({ where: { id: cardId }, data: fence === "same-fingerprint"
        ? { scryfallFingerprint: scryfallFingerprint(payload) }
        : { lastSyncedAt: new Date("2099-01-01") } });
      const before = await read();
      await (await prepare(payload)).write();
      assert.deepEqual(await read(), before, `${fence} must preserve metadata and prices`);
    }

    // Force metadata and prices to fail after the metadata UPDATE has executed.
    const before = await seed();
    const pending = await prepare(incoming);
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${cardId}' AND NEW.prices IS DISTINCT FROM OLD.prices THEN RAISE EXCEPTION 'owned acquisition price rollback'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE UPDATE ON "Card" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    triggerCreated = true;
    await assert.rejects(pending.write(), /owned acquisition price rollback/);
    assert.deepEqual(await read(), before, "Metadata and price failure must roll back together");
    if ("runId" in pending) {
      const run = await db.acquisitionCatalogRefresh.findUniqueOrThrow({ where: { id: pending.runId } });
      assert.equal(run.processedRows, 0); assert.equal(run.updatedCards, 0);
    } else {
      const lookup = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: pending.key } });
      assert.equal(lookup.status, "RUNNING", "Failed publication must not claim FOUND");
    }
    await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "Card"`);
    await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`); triggerCreated = false;

    // Real row-lock barriers verify both orders against the independent Pricing writer.
    for (const order of ["pricing-first", "pricing-last", ...(writer === "bulk" ? ["metadata-wins"] : [])]) {
      const pricingFirst = order === "pricing-first";
      await seed();
      const pending = await prepare({ ...payload, prices: { usd: "9.00" } });
      const concurrent = { revision: randomUUID() };
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>(r => { acquired = r; });
      const gate = new Promise<void>(r => { release = r; });
      const holder = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Card" WHERE id=${cardId} FOR UPDATE`;
        if (pricingFirst) await tx.$executeRaw`UPDATE "Card" SET prices=jsonb_set(prices::jsonb,'{mtgjson}',${JSON.stringify(concurrent)}::jsonb) WHERE id=${cardId}`;
        if (order === "metadata-wins") await tx.card.update({ where: { id: cardId }, data: {
          scryfallFingerprint: "newer-concurrent-writer", lastSyncedAt: new Date("2099-01-01"),
        } });
        acquired(); await gate;
      }, { timeout: 20000 });
      let refresh: Promise<unknown> | undefined, pricing: Promise<unknown> | undefined;
      async function blocked(count: number) {
        const deadline = Date.now() + 5000;
        do {
          const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"Card"%' AND pid<>pg_backend_pid()`;
          if (row.count >= count) return;
          await new Promise(r => setTimeout(r, 25));
        } while (Date.now() < deadline);
        throw Error("Owned acquisition writer did not reach the Card row lock");
      }
      try {
        await locked; refresh = pending.write(); await blocked(1);
        if (order === "pricing-last") {
          pricing = db.$executeRaw`UPDATE "Card" SET prices=jsonb_set(prices::jsonb,'{mtgjson}',${JSON.stringify(concurrent)}::jsonb) WHERE id=${cardId}`.then(n => n);
          await blocked(2);
        }
        release(); await Promise.all([holder, refresh, pricing]);
        if (order === "metadata-wins") {
          const after = await read();
          assert.equal(after.scryfallFingerprint, "newer-concurrent-writer");
          assert.deepEqual(after.prices, { usd: "1.00", obsolete_price: "remove", mtgjson });
          if ("runId" in pending) {
            const run = await db.acquisitionCatalogRefresh.findUniqueOrThrow({ where: { id: pending.runId } });
            assert.equal(run.updatedCards, 0); assert.equal(run.preservedCards, 1);
          }
        } else assert.deepEqual((await read()).prices, { usd: "9.00", mtgjson: concurrent });
      } finally { release(); await Promise.allSettled([holder, refresh, pricing]); }
    }
    assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: inventoryId } }), inventory);
    assert.equal(await db.inventoryAuditLog.count({ where: { inventoryItemId: inventoryId } }), 0);
  } finally {
    if (triggerCreated) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "Card"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
    }
    await db.acquisitionCatalogLookup.deleteMany({ where: { key: { in: keys } } });
    await db.acquisitionCatalogRefresh.deleteMany({ where: { id: { in: refreshes } } });
    if (inventoryId) await db.inventoryItem.delete({ where: { id: inventoryId } });
    await db.card.deleteMany({ where: { scryfallId: { in: [id, secondId] } } });
  }
}
