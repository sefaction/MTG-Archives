import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import type { CatalogLookupResult } from "../lib/acquisition-catalog-provider";
import type { ScryfallCard } from "../lib/scryfall";

export async function verifyAcquisitionCatalogCache(db: PrismaClient) {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const name = `Lookup ${randomUUID()}`;
  const query = { kind: "name" as const, name };
  const missing = { kind: "name" as const, name: `${name} missing` };
  const key = catalogQueryKey(query);
  const keys = [key, catalogQueryKey(missing)];
  const card = (id: string, set = "tst", title = name): ScryfallCard => ({
    object: "card",
    id,
    name: title,
    set,
    set_name: "Fixture",
    collector_number: set === "plst" ? "TST-1" : "1",
    rarity: "common",
    lang: "en",
    cmc: 1,
    color_identity: [],
    digital: false,
  });
  const success: CatalogLookupResult = {
    status: "FOUND",
    cards: [card(ids[0]), card(ids[1], "plst")],
    requestsMade: 2,
    printingCoverage: "CHECKED",
  };
  let calls = 0;
  let release!: (result: CatalogLookupResult) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise<CatalogLookupResult>((resolve) => {
    release = resolve;
  });
  const signal = () => AbortSignal.timeout(30000);
  try {
    const first = resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        calls++;
        entered();
        return delayed;
      },
    );
    await started;
    const other = await resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        calls++;
        return success;
      },
    );
    assert.equal(other.status, "PENDING");
    release(success);
    assert.equal((await first).status, "FOUND");
    assert.equal(calls, 1);
    const local = await db.card.findUniqueOrThrow({
      where: { scryfallId: ids[0] },
    });
    const cached = await resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        throw new Error("No repeated HTTP lookup expected");
      },
    );
    assert.equal(cached.status, "FOUND");
    assert.equal(cached.cacheHit, true);
    if (cached.status === "FOUND") assert.equal(cached.cards.length, 2);

    await db.card.delete({ where: { scryfallId: ids[1] } });
    const repaired = await resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        calls++;
        return success;
      },
    );
    assert.equal(repaired.status, "FOUND");
    assert.equal(repaired.cacheHit, false);
    assert.equal(calls, 2);
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { scryfallId: ids[0] } })).id,
      local.id,
    );
    assert.ok(await db.card.findUnique({ where: { scryfallId: ids[1] } }));

    const absent: CatalogLookupResult = {
      status: "NOT_FOUND",
      cards: [],
      requestsMade: 1,
      printingCoverage: "UNRESOLVED",
      errorKind: "NOT_FOUND",
    };
    await resolveCachedAcquisitionCatalog(
      db,
      missing,
      signal(),
      async () => absent,
    );
    assert.equal(
      (
        await resolveCachedAcquisitionCatalog(
          db,
          missing,
          signal(),
          async () => {
            throw new Error("Negative result should be cached");
          },
        )
      ).cacheHit,
      true,
    );
    await db.acquisitionCatalogLookup.update({
      where: { key: keys[1] },
      data: { expiresAt: new Date(0) },
    });
    const failed: CatalogLookupResult = {
      status: "PROVIDER_ERROR",
      cards: [],
      requestsMade: 1,
      printingCoverage: "UNRESOLVED",
      errorKind: "RATE_LIMITED",
      retryAfterMs: 900000,
    };
    assert.equal(
      (
        await resolveCachedAcquisitionCatalog(
          db,
          missing,
          signal(),
          async () => failed,
        )
      ).status,
      "PROVIDER_ERROR",
    );
    const cooldown = await db.acquisitionCatalogLookup.findUniqueOrThrow({
      where: { key: keys[1] },
    });
    assert.ok(
      cooldown.expiresAt && cooldown.expiresAt.getTime() > Date.now() + 899000,
    );
    await db.acquisitionCatalogLookup.update({
      where: { key },
      data: { expiresAt: new Date(0) },
    });
    const blocked = await resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        throw new Error("Shared cooldown must prevent another request");
      },
    );
    assert.equal(blocked.status, "PROVIDER_ERROR");
    if (blocked.status === "PROVIDER_ERROR")
      assert.equal(blocked.requestsMade, 0);
    await db.acquisitionCatalogLookup.update({
      where: { key: keys[1] },
      data: { expiresAt: new Date(0) },
    });

    // An expired worker cannot publish after a newer lease has completed.
    await db.acquisitionCatalogLookup.update({
      where: { key },
      data: { expiresAt: new Date(0) },
    });
    let enterOld!: () => void,
      finishOld!: (result: CatalogLookupResult) => void;
    const oldStarted = new Promise<void>((resolve) => {
      enterOld = resolve;
    });
    const oldResponse = new Promise<CatalogLookupResult>((resolve) => {
      finishOld = resolve;
    });
    const old = resolveCachedAcquisitionCatalog(
      db,
      query,
      signal(),
      async () => {
        enterOld();
        return oldResponse;
      },
    );
    await oldStarted;
    await db.acquisitionCatalogLookup.update({
      where: { key },
      data: { leaseExpiresAt: new Date(0) },
    });
    const fresh = {
      ...success,
      cards: [card(ids[0], "tst", `${name} refreshed`)],
    };
    assert.equal(
      (
        await resolveCachedAcquisitionCatalog(
          db,
          query,
          signal(),
          async () => fresh,
        )
      ).status,
      "FOUND",
    );
    finishOld(success);
    assert.equal((await old).status, "PENDING");
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { scryfallId: ids[0] } })).name,
      `${name} refreshed`,
    );
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { scryfallId: ids[0] } })).id,
      local.id,
    );
    console.log(
      "Catalog fallback: shared cache, missing-row repair, stable IDs, negative cache, cooldown and stale-lease fencing passed.",
    );
  } finally {
    // This helper runs only inside the existing opt-in disposable-DB verifier.
    await db.acquisitionCatalogLookup.deleteMany({
      where: { key: { in: keys } },
    });
    await db.card.deleteMany({ where: { scryfallId: { in: ids } } });
  }
}
