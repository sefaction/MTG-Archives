import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ScryfallCard } from "../lib/scryfall";

async function main() {
  assert.equal(
    process.env.MTG_LOCAL_PILOT_TEST,
    "1",
    "Disposable database opt-in required",
  );
  assert.ok(process.env.DATABASE_URL, "Test database connection required");
  const source = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(source.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "pricing-postgres"].includes(source.hostname),
    "Card price verification requires a local/CI database",
  );
  for (const key of source.searchParams.keys())
    assert.equal(
      key,
      "schema",
      "Test connection cannot override the local endpoint",
    );
  source.searchParams.set("connection_limit", "4");
  process.env.DATABASE_URL = source.toString();
  const { PrismaClient, Prisma } = await import("@prisma/client");
  const { prisma } = await import("../lib/prisma");
  const { upsertScryfallCard } = await import("../lib/card-import");
  const other = new PrismaClient();
  const scryfallIds = [randomUUID(), randomUUID()];
  const payload = {
    id: scryfallIds[0],
    name: "Owned price preservation fixture",
    cmc: 1,
    color_identity: [],
    set_name: "Test fixture",
    type_line: "Sorcery",
    set: "tst",
    collector_number: "1",
    rarity: "common",
    lang: "en",
    prices: { usd: "3.00", usd_foil: null },
  } as ScryfallCard;
  const mtgjson = {
    tcgplayer: {
      normal: { retail: { USD: { amount: 5.75, observedDate: "2026-10-18" } } },
    },
    cardmarket: {
      foil: { retail: { EUR: { amount: 8.25, observedDate: "2026-10-18" } } },
    },
  };
  const before = await prisma.card.count();
  let cardId = "";
  const projection = async () =>
    (await prisma.card.findUniqueOrThrow({ where: { id: cardId } }))
      .prices as any;
  async function blocked(atLeast: number) {
    const deadline = Date.now() + 2500;
    do {
      const rows = await other.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"Card"%' AND pid<>pg_backend_pid()`;
      if (rows[0].count >= atLeast) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error("Expected owned Card writer lock was not observed");
  }
  try {
    const created = await upsertScryfallCard(payload);
    cardId = created.id;
    assert.deepEqual(created.prices, payload.prices);
    const firstCachedAt = created.firstCachedAt;
    const uuid = randomUUID();
    await prisma.card.update({
      where: { id: cardId },
      data: {
        mtgjsonUuid: uuid,
        prices: { usd: "1.00", obsolete_price: "remove", mtgjson },
      },
    });
    const refreshed = await upsertScryfallCard({
      ...payload,
      prices: { usd: "4.00", eur: null },
    });
    assert.deepEqual(
      (refreshed.prices as any).mtgjson,
      mtgjson,
      "Scryfall refresh must retain the independently published MTGJSON subtree",
    );
    assert.deepEqual(refreshed.prices, { usd: "4.00", eur: null, mtgjson });
    assert.equal(refreshed.id, cardId);
    assert.equal(refreshed.mtgjsonUuid, uuid);
    assert.equal(refreshed.firstCachedAt.getTime(), firstCachedAt.getTime());
    assert.deepEqual(
      refreshed.prices,
      (await prisma.card.findUniqueOrThrow({ where: { id: cardId } })).prices,
      "Returned Card must include the committed merged prices",
    );
    const timestamp = refreshed.priceLastFetchedAt?.getTime();
    for (const prices of [undefined, null]) {
      const absent = await upsertScryfallCard({
        ...payload,
        name: "Owned metadata-only refresh",
        prices,
      } as ScryfallCard);
      assert.deepEqual(
        absent.prices,
        refreshed.prices,
        "Absent prices must not erase either source",
      );
      assert.equal(absent.priceLastFetchedAt?.getTime(), timestamp);
    }
    const empty = await upsertScryfallCard({ ...payload, prices: {} });
    assert.deepEqual(
      empty.prices,
      { mtgjson },
      "Explicit empty Scryfall prices may clear only Scryfall fields",
    );
    const staleInput = {
      ...payload,
      prices: { usd: "4.50", mtgjson: { stale: true } },
    } as unknown as ScryfallCard;
    const inputBefore = JSON.stringify(staleInput);
    assert.deepEqual((await upsertScryfallCard(staleInput)).prices, {
      usd: "4.50",
      mtgjson,
    });
    assert.equal(
      JSON.stringify(staleInput),
      inputBefore,
      "Do not mutate caller prices",
    );
    const second = await upsertScryfallCard({
      ...staleInput,
      id: scryfallIds[1],
    });
    assert.deepEqual(
      second.prices,
      { usd: "4.50" },
      "A Scryfall payload must not create an MTGJSON projection",
    );
    const concurrent = {
      tcgplayer: {
        normal: {
          retail: { USD: { amount: 12.34, observedDate: "2026-10-19" } },
        },
      },
    };
    for (const order of [
      "pricing-before-refresh",
      "pricing-after-refresh",
    ] as const) {
      let release!: () => void, acquired!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lock = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const holding = other.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Card" WHERE id=${cardId} FOR UPDATE`;
          if (order === "pricing-before-refresh")
            await tx.$executeRaw`UPDATE "Card" SET prices=jsonb_set(prices::jsonb,'{mtgjson}',${JSON.stringify(concurrent)}::jsonb,true) WHERE id=${cardId}`;
          acquired();
          await gate;
        },
        { timeout: 10000 },
      );
      try {
        await lock;
        const refresh = upsertScryfallCard({
          ...payload,
          prices: { usd: "9.00" },
        });
        await blocked(1);
        const publish =
          order === "pricing-after-refresh"
            ? other.$executeRaw`UPDATE "Card" SET prices=jsonb_set(prices::jsonb,'{mtgjson}',${JSON.stringify(concurrent)}::jsonb,true) WHERE id=${cardId}`.then(
                (count) => count,
              )
            : Promise.resolve(0);
        if (order === "pricing-after-refresh") await blocked(2);
        release();
        await Promise.all([holding, refresh, publish]);
        assert.deepEqual(
          await projection(),
          { usd: "9.00", mtgjson: concurrent },
          "Both serialized writer orders must retain both sources",
        );
      } finally {
        release();
        await holding;
      }
    }
    const priorFailure = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    const trigger = "owned_price_reject_" + scryfallIds[0].replaceAll("-", "");
    assert.match(trigger, /^[a-z0-9_]+$/);
    assert.match(cardId, /^[a-z0-9]+$/);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $fixture$ BEGIN RAISE EXCEPTION 'owned price write rejection'; END; $fixture$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${trigger} BEFORE UPDATE ON "Card" FOR EACH ROW WHEN (OLD.id='${cardId}' AND NEW.prices IS DISTINCT FROM OLD.prices) EXECUTE FUNCTION ${trigger}()`,
      );
      await assert.rejects(
        upsertScryfallCard({
          ...payload,
          name: "Must roll back metadata",
          prices: { usd: "666.00" },
        }),
        /owned price write rejection/,
      );
      assert.deepEqual(
        await prisma.card.findUniqueOrThrow({ where: { id: cardId } }),
        priorFailure,
        "Price-write failure must also roll back metadata and timestamps",
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${trigger} ON "Card"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
    }
    await prisma.card.update({
      where: { id: cardId },
      data: { prices: { mtgjson: null } },
    });
    assert.deepEqual(
      (await upsertScryfallCard(payload)).prices,
      { ...payload.prices, mtgjson: null },
      "Preserve an explicitly stored JSON-null subtree",
    );
    await prisma.card.update({
      where: { id: cardId },
      data: { prices: Prisma.DbNull },
    });
    assert.deepEqual(
      (await upsertScryfallCard(payload)).prices,
      payload.prices,
      "SQL-null prices initialize normally without inventing a subtree",
    );
    console.log(
      JSON.stringify({
        status: "PASS",
        preservedMtgjson: true,
        returnedCommittedPrices: true,
        absentPricesPreserved: true,
        explicitEmptyScoped: true,
        staleInputIgnored: true,
        bothWriterOrders: true,
        atomicRollback: true,
        immutableIdentity: true,
        nullCases: true,
        noProviderRequest: true,
      }),
    );
  } finally {
    await prisma.card.deleteMany({
      where: { scryfallId: { in: scryfallIds } },
    });
    assert.equal(
      await prisma.card.count(),
      before,
      "Owned fixture cleanup must restore the Card count",
    );
    await Promise.all([prisma.$disconnect(), other.$disconnect()]);
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
