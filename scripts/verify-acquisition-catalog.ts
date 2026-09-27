import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AcquisitionActor } from "../lib/acquisition-store";
import { searchLocalCardCatalog } from "../lib/local-card-search";
import {
  beginAcquisitionCatalog,
  applyAcquisitionCatalogBatch,
  finishAcquisitionCatalog,
} from "../lib/acquisition-catalog";

export async function verifyAcquisitionCatalog(
  db: PrismaClient,
  admin: AcquisitionActor,
  member: AcquisitionActor,
  existingCardId: string,
) {
  const existing = await db.card.findUniqueOrThrow({
    where: { id: existingCardId },
  });
  const newIds = [randomUUID(), randomUUID()];
  const uuid = randomUUID();
  const source = {
    sourceDigest: createHash("sha256").update(uuid).digest("hex"),
    sourceType: "scryfall-default-jsonl-gzip-v1",
    sourceUpdatedAt: "2026-09-27T09:00:00Z",
    sourceBytes: 1000,
    expectedRows: 3,
  };
  const card = (id: string, number: string) => ({
    object: "card",
    id,
    name: `Catalog ${uuid}`,
    set: "tst",
    set_name: "Fixture",
    collector_number: number,
    rarity: "common",
    cmc: 1,
    color_identity: ["G"],
    lang: "en",
    type_line: "Creature",
    card_faces: [
      { name: "Front", printed_name: "Face locale" },
      { name: "Back" },
    ],
  });
  const cards = [
    card(existing.scryfallId, "1a"),
    {
      ...card(newIds[0], "2"),
      cmc: undefined,
      type_line: undefined,
      card_faces: [
        { name: "Front", type_line: "Creature", cmc: 2 },
        { name: "Back", type_line: "Creature", cmc: 4 },
      ],
    },
    { ...card(newIds[1], "3"), lang: "fr" },
  ];
  try {
    await assert.rejects(
      beginAcquisitionCatalog(db, member, source),
      /administrator/,
    );
    await assert.rejects(
      beginAcquisitionCatalog(db, { ...admin, adminMode: false }, source),
      /administrator/,
    );
    const [first, replay] = await Promise.all([
      beginAcquisitionCatalog(db, admin, source),
      beginAcquisitionCatalog(db, admin, source),
    ]);
    assert.equal(first.id, replay.id);
    await assert.rejects(
      beginAcquisitionCatalog(db, admin, { ...source, expectedRows: 4 }),
      /conflicts/,
    );
    await assert.rejects(
      finishAcquisitionCatalog(db, admin, first.id, source.sourceDigest),
      /incomplete/,
    );
    const fault = db.$extends({
      query: {
        acquisitionCatalogRefresh: {
          async update() {
            throw new Error("injected cursor failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    await assert.rejects(
      applyAcquisitionCatalogBatch(
        fault,
        admin,
        first.id,
        0,
        cards.slice(0, 2),
      ),
      /injected/,
    );
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { id: existingCardId } })).name,
      existing.name,
    );
    assert.equal(await db.card.count({ where: { scryfallId: newIds[0] } }), 0);
    assert.equal(
      (
        await db.acquisitionCatalogRefresh.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).processedRows,
      0,
    );
    const race = await Promise.all([
      applyAcquisitionCatalogBatch(db, admin, first.id, 0, cards.slice(0, 2)),
      applyAcquisitionCatalogBatch(db, admin, first.id, 0, cards.slice(0, 2)),
    ]);
    assert.equal(race.filter((r) => r.replay).length, 1);
    assert.equal(race[0].run.processedRows, 2);
    await assert.rejects(
      applyAcquisitionCatalogBatch(db, admin, first.id, 1, cards.slice(1)),
      /cursor/,
    );
    // New client simulates process restart; a failed marker retains its cursor.
    await db.acquisitionCatalogRefresh.update({
      where: { id: first.id },
      data: { status: "FAILED", errorCode: "IMPORT_INTERRUPTED" },
    });
    const reconnected = new (db.constructor as typeof PrismaClient)();
    try {
      const resumed = await beginAcquisitionCatalog(reconnected, admin, source);
      assert.equal(resumed.processedRows, 2);
      await applyAcquisitionCatalogBatch(reconnected, admin, first.id, 2, [
        cards[2],
      ]);
    } finally {
      await reconnected.$disconnect();
    }
    await assert.rejects(
      finishAcquisitionCatalog(db, admin, first.id, "bad-digest"),
      /changed/,
    );
    const done = await finishAcquisitionCatalog(
      db,
      admin,
      first.id,
      source.sourceDigest,
    );
    assert.equal(done.status, "COMPLETE");
    assert.equal(done.createdCards, 2);
    assert.equal(done.updatedCards, 1);
    const reversible = await db.card.findUniqueOrThrow({
      where: { scryfallId: newIds[0] },
    });
    assert.equal(reversible.manaValue, null);
    assert.equal(reversible.typeLine, "Creature // Creature");
    const changed = await db.card.findUniqueOrThrow({
      where: { scryfallId: existing.scryfallId },
    });
    assert.equal(changed.id, existing.id);
    assert.equal(changed.collectorNumber, "1a");
    assert.deepEqual(changed.cardFaces, cards[0].card_faces);
    assert.equal(
      await db.inventoryItem.count({ where: { cardId: existingCardId } }),
      1,
    );
    assert.equal(
      (
        await db.inventoryItem.aggregate({
          where: { cardId: existingCardId },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      28,
    );
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { scryfallId: newIds[1] } }))
        .lang,
      "fr",
    );
    // A fresher live fetch wins over an older bulk snapshot and is counted.
    await db.card.update({
      where: { id: existingCardId },
      data: {
        name: "Fresher direct fetch",
        lastSyncedAt: new Date("2026-09-28T00:00:00Z"),
      },
    });
    const secondSource = {
      ...source,
      sourceDigest: createHash("sha256")
        .update(uuid + "2")
        .digest("hex"),
      expectedRows: 1,
    };
    const second = await beginAcquisitionCatalog(db, admin, secondSource);
    await db.user.update({
      where: { id: admin.userId },
      data: { isActive: false },
    });
    await assert.rejects(
      applyAcquisitionCatalogBatch(db, admin, second.id, 0, [cards[0]]),
      /administrator/,
    );
    await db.user.update({
      where: { id: admin.userId },
      data: { isActive: true },
    });
    const preserved = await applyAcquisitionCatalogBatch(
      db,
      admin,
      second.id,
      0,
      [cards[0]],
    );
    assert.equal(preserved.run.preservedCards, 1);
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { id: existingCardId } })).name,
      "Fresher direct fetch",
    );
    await finishAcquisitionCatalog(
      db,
      admin,
      second.id,
      secondSource.sourceDigest,
    );
    // Also race a live update AFTER the importer reads the old fingerprint.
    await db.card.update({
      where: { id: existingCardId },
      data: {
        lastSyncedAt: new Date("2026-09-20T00:00:00Z"),
        scryfallFingerprint: "old",
      },
    });
    const raceSource = {
      ...secondSource,
      sourceDigest: createHash("sha256")
        .update(uuid + "3")
        .digest("hex"),
    };
    const third = await beginAcquisitionCatalog(db, admin, raceSource);
    let raced = false;
    const racing = db.$extends({
      query: {
        card: {
          async updateMany({ args, query }) {
            if (!raced) {
              raced = true;
              await db.card.update({
                where: { id: existingCardId },
                data: {
                  name: "Concurrent live fetch",
                  lastSyncedAt: new Date("2026-09-28T00:00:00Z"),
                  scryfallFingerprint: "new",
                },
              });
            }
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const fenced = await applyAcquisitionCatalogBatch(
      racing,
      admin,
      third.id,
      0,
      [cards[0]],
    );
    assert.equal(fenced.run.preservedCards, 1);
    assert.equal(
      (await db.card.findUniqueOrThrow({ where: { id: existingCardId } })).name,
      "Concurrent live fetch",
    );
    await finishAcquisitionCatalog(
      db,
      admin,
      third.id,
      raceSource.sourceDigest,
    );
    // Compare every filter branch and stable ordering with the existing Prisma
    // semantics, including punctuation/wildcards and hostile SQL-looking input.
    for (const query of [
      "Catalog",
      "TST",
      "1a",
      "Creature",
      "fr",
      "%",
      "_",
      "' OR 1=1 --",
    ])
      for (const includeTypeLine of [false, true]) {
        const expected = await db.card.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { setCode: { equals: query.toLowerCase(), mode: "insensitive" } },
              { collectorNumber: query },
              ...(includeTypeLine
                ? [
                    {
                      typeLine: {
                        contains: query,
                        mode: "insensitive" as const,
                      },
                    },
                  ]
                : []),
            ],
          },
          orderBy: [{ name: "asc" }, { releasedAt: "desc" }, { id: "asc" }],
          take: 2,
        });
        const actual = await searchLocalCardCatalog(db, {
          query,
          setCode: query.toLowerCase(),
          limit: 2,
          includeTypeLine,
        });
        assert.deepEqual(
          actual,
          expected,
          `search parity ${query}/${includeTypeLine}`,
        );
      }
    console.log(
      "PASS: catalog ownership, atomic cursor rollback, two-writer replay, resume, existing Inventory references, suffix/face/language preservation and newer-data protection",
    );
  } finally {
    await db.user.update({
      where: { id: admin.userId },
      data: { isActive: true },
    });
    await db.acquisitionCatalogRefresh.deleteMany({
      where: { requestedByUserId: admin.userId },
    });
    await db.card.deleteMany({ where: { scryfallId: { in: newIds } } });
  }
}
