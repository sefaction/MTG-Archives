import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryQueryMetadataSql,
  matchingInventoryQueryCardIds,
  QUERY_METADATA_BATCH_SIZE,
  queryMetadataForFields,
} from "../lib/inventory-query-metadata";
import { constrainInventoryWhereToScryfallQuery } from "../lib/inventory-scryfall-query";

test("metadata SQL binds IDs and projects only evaluator fields/fallbacks", () => {
  const id = "x'); DROP TABLE Card; --";
  const sql = inventoryQueryMetadataSql([id]);
  assert.equal(sql.values.at(-1), id);
  assert.ok(!sql.text.includes(id));
  assert.match(sql.text, /"printedTypeLine"/);
  assert.ok(sql.values.includes("card_faces"));
  assert.ok(sql.values.includes("legalities"));
  assert.match(sql.text, /jsonb_each/);
  assert.doesNotMatch(sql.text, /purchaseUris|imageUris|SELECT \*/);
  assert.throws(() => inventoryQueryMetadataSql([]));
  assert.throws(() => inventoryQueryMetadataSql(Array(501).fill("x")));
});

test("metadata loads in bounded batches, retaining only matches", async () => {
  const sizes: number[] = [];
  const ids = Array.from({ length: 1201 }, (_, i) => String(i));
  const matches = await matchingInventoryQueryCardIds(
    {
      $queryRaw: async (sql) => {
        sizes.push(sql.values.length);
        return sql.values.map((id) => ({
          id,
          typeLine: Number(id) % 2 ? "Land" : "Creature",
        }));
      },
    },
    ids,
    (card) => card.typeLine === "Creature",
    queryMetadataForFields([]),
  );
  assert.deepEqual(sizes, [
    QUERY_METADATA_BATCH_SIZE,
    QUERY_METADATA_BATCH_SIZE,
    201,
  ]);
  assert.equal(matches.length, 601);
  assert.equal(matches.at(-1), "1200");
});

test("common query metadata is narrow but retains legacy face fallbacks", () => {
  const projection = queryMetadataForFields(["type", "mv", "type"]);
  assert.deepEqual(projection.columns, [
    "id",
    "typeLine",
    "printedTypeLine",
    "cardFaces",
    "manaValue",
  ]);
  assert.deepEqual(projection.raw, ["card_faces"]);
  assert.ok(queryMetadataForFields(["has"]).raw.includes("content_warning"));
  assert.ok(queryMetadataForFields(["power"]).columns.includes("toughness"));
});

test("empty, invalid, and invisible inventory queries do not load card metadata", async () => {
  let candidates = 0;
  const db = {
    inventoryItem: {
      findMany: async () => {
        candidates++;
        return [];
      },
    },
    $queryRaw: async () => {
      throw new Error("No metadata should be requested");
    },
  };
  const where = { currentOwnerId: "private-owner", quantity: { gt: 0 } };
  assert.equal(
    (await constrainInventoryWhereToScryfallQuery(db, where, "")).where,
    where,
  );
  assert.ok(
    (await constrainInventoryWhereToScryfallQuery(db, where, "bogus:value"))
      .error,
  );
  assert.equal(candidates, 0);
  const result = await constrainInventoryWhereToScryfallQuery(
    db,
    where,
    "t:creature",
  );
  assert.equal(candidates, 1);
  assert.deepEqual(result.where, { ...where, cardId: { in: [] } });
});
