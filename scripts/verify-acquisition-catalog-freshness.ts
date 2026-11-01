import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Card, InventoryItem } from "@prisma/client";
import { cardWriteData } from "../lib/card-import";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import type { AcquisitionActor } from "../lib/acquisition-store";
import type { ScryfallCard } from "../lib/scryfall";

export type CatalogFreshnessScenario =
  | "existing-newer"
  | "existing-changed"
  | "insert-newer";

// Actual SQL writers with observed row-lock barriers, without guessed timing or
// test-only production hooks.
export async function verifyAcquisitionCatalogFreshness(
  db: PrismaClient,
  actor: AcquisitionActor,
  scenario: CatalogFreshnessScenario,
) {
  const id = randomUUID(), uuid = randomUUID();
  const query = { kind: "name" as const, name: `Owned freshness ${id}` };
  const key = catalogQueryKey(query);
  const owner = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  assert.ok(owner.playerId);
  const payload: ScryfallCard = {
    object: "card", id, name: query.name, set: "tst", set_name: "Fixture",
    collector_number: "1", rarity: "common", cmc: 1, color_identity: [],
    lang: "en", type_line: "Sorcery", oracle_text: "Delayed provider metadata",
    prices: { usd: "1.00" },
  };
  const fresh = { ...payload, oracle_text: "Concurrent committed metadata", prices: { usd: "11.00" } };
  const mtgjson = { tcgplayer: { normal: { retail: { USD: { amount: 7.5, observedDate: "2026-11-01" } } } } };
  let winningCard: Card | undefined, inventory: InventoryItem | undefined;
  let acquired!: () => void, release!: () => void;
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let holder: Promise<unknown> | undefined, lookup: Promise<unknown> | undefined;
  try {
    if (scenario !== "insert-newer") {
      const initial = await db.card.create({ data: {
        ...cardWriteData(payload), scryfallId: id, mtgjsonUuid: uuid,
        firstCachedAt: new Date("1999-01-01"), lastSyncedAt: new Date("2000-01-01"),
        scryfallFingerprint: "initial-metadata", prices: { usd: "2.00", mtgjson },
      } as Prisma.CardCreateInput });
      inventory = await db.inventoryItem.create({ data: {
        cardId: initial.id, currentOwnerId: owner.playerId, quantity: 7,
        condition: "LP", sourceType: "MANUAL",
      } });
    }
    holder = db.$transaction(async tx => {
      const data = {
        ...cardWriteData(fresh),
        lastSyncedAt: new Date(scenario === "existing-changed" ? "2001-01-01" : "2099-01-01"),
        prices: { usd: "11.00", mtgjson },
      };
      if (scenario === "insert-newer") {
        winningCard = await tx.card.create({ data: {
          ...data, scryfallId: id, mtgjsonUuid: uuid, firstCachedAt: new Date("1999-01-01"),
        } as Prisma.CardCreateInput });
        inventory = await tx.inventoryItem.create({ data: {
          cardId: winningCard.id, currentOwnerId: owner.playerId!, quantity: 7,
          condition: "LP", sourceType: "MANUAL",
        } });
      } else {
        // The lookup's ordinary read still sees the prior committed row, then
        // waits on its metadata write while this newer version is uncommitted.
        winningCard = await tx.card.update({ where: { scryfallId: id }, data: data as Prisma.CardUpdateInput });
      }
      acquired(); await gate;
    }, { timeout: 20000 });
    await locked;
    let providerCalls = 0;
    lookup = resolveCachedAcquisitionCatalog(db, query, AbortSignal.timeout(30000), async () => {
      providerCalls++;
      return { status: "FOUND", cards: [payload], requestsMade: 0, printingCoverage: "CHECKED" };
    });
    const deadline = Date.now() + 5000;
    let observedLock = false;
    do {
      const [row] = await db.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%"Card"%' AND pid<>pg_backend_pid()
      `;
      if (row.count >= 1) { observedLock = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.ok(observedLock, "The delayed lookup must actually wait on the concurrent Card writer");
    release(); await Promise.all([holder, lookup]);
    const persisted = await db.card.findUniqueOrThrow({ where: { scryfallId: id } });
    assert.equal(persisted.oracleText, fresh.oracle_text,
      "Cache must retain metadata committed after its read");
    assert.deepEqual(persisted, winningCard, "The complete winning Card must remain unchanged");
    assert.equal(persisted.mtgjsonUuid, uuid);
    assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: inventory!.id } }), inventory);
    assert.equal(await db.inventoryAuditLog.count({ where: { inventoryItemId: inventory!.id } }), 0);
    const published = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key } });
    assert.equal(published.status, "FOUND"); assert.equal(published.leaseToken, null);
    const warm = await resolveCachedAcquisitionCatalog(db, query, AbortSignal.timeout(10000), async () => {
      throw Error("Warm lookup must reuse the winning Card");
    });
    assert.equal(warm.status, "FOUND"); assert.equal(warm.cacheHit, true);
    if (warm.status === "FOUND") assert.deepEqual(warm.cards, [fresh]);
    assert.equal(providerCalls, 1);
  } finally {
    release(); await Promise.allSettled([holder, lookup]);
    await db.acquisitionCatalogLookup.deleteMany({ where: { key } });
    if (inventory) await db.inventoryItem.deleteMany({ where: { id: inventory.id } });
    await db.card.deleteMany({ where: { scryfallId: id } });
  }
}
