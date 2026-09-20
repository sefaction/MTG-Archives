// Read-only, opt-in parity/size check against the disposable local snapshot.
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  inventoryQueryMetadataSql,
  QUERY_METADATA_BATCH_SIZE,
} from "../lib/inventory-query-metadata";
import { compileLocalScryfallQuery } from "../lib/inventory-scryfall-query";

if (process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Set MTG_LOCAL_PILOT_TEST=1 only for the local snapshot.");

const db = new PrismaClient();
const queries = [
  "t:creature",
  "t:land OR -t:artifact",
  "t:/creature|land/",
  "n:Esika",
  "o:draw",
  "fo:flying",
  "m:g",
  "mv>=3",
  "pow>tou",
  "tou>=3",
  "loy>=1",
  "def>=1",
  "c=wu",
  "id<=wubrg",
  "commander:wubrg",
  "devotion:g",
  "year>=2020",
  "date>=2020-01-01",
  "usd<5",
  "eur<5",
  "tix<5",
  "legal:commander",
  "banned:modern",
  "restricted:vintage",
  "f:commander",
  "in:paper",
  "in:foil",
  "in:modern",
  "is:dfc",
  "is:legendary",
  "is:vanilla",
  "is:bear",
  "is:companion",
  "is:partner",
  "is:foil",
  "has:flavor",
  "has:watermark",
  "has:contentwarning",
  "has:arenaid",
  "has:illustration",
  "has:oracletext",
  "has:manacost",
  "has:indicator",
  "kw:flying",
  "ft:war",
  "wm:azorius",
  "set:neo",
  "setname:modern",
  "st:expansion",
  "r:rare",
  "a:john",
  "cn:1",
  "lang:en",
  "layout:normal",
  "frame:2015",
  "border:black",
  "stamp:oval",
  "game:paper",
  "produces:g",
];

async function main() {
  await db.$transaction(
    async (tx) => {
      const candidates = await tx.inventoryItem.findMany({
        where: { quantity: { gt: 0 } },
        distinct: ["cardId"],
        select: { cardId: true },
      });
      assert.ok(
        candidates.length > 0,
        "The local snapshot must contain inventory.",
      );
      const ids = candidates.map((item) => item.cardId);
      const fullStarted = performance.now();
      const full = await tx.card.findMany({ where: { id: { in: ids } } });
      const fullMs = Math.round(performance.now() - fullStarted);
      const projected: any[] = [];
      const leanStarted = performance.now();
      for (let i = 0; i < ids.length; i += QUERY_METADATA_BATCH_SIZE) {
        const batch = await tx.$queryRaw<any[]>(
          inventoryQueryMetadataSql(
            ids.slice(i, i + QUERY_METADATA_BATCH_SIZE),
          ),
        );
        projected.push(...batch);
      }
      const projectedMs = Math.round(performance.now() - leanStarted);
      assert.equal(projected.length, full.length);
      for (const query of queries) {
        const compiled = compileLocalScryfallQuery(query);
        assert.ok(compiled.ok, query);
        if (!compiled.ok) continue;
        const expected = full
          .filter(compiled.matches)
          .map((card) => card.id)
          .sort();
        const actual = projected
          .filter(compiled.matches)
          .map((card) => card.id)
          .sort();
        assert.deepEqual(actual, expected, query);
      }
      console.log(
        JSON.stringify({
          candidates: ids.length,
          queries: queries.length,
          fullMs,
          projectedMs,
          fullBytes: Buffer.byteLength(JSON.stringify(full)),
          projectedBytes: Buffer.byteLength(JSON.stringify(projected)),
          parity: "passed",
        }),
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 180_000,
    },
  );
}
main().finally(() => db.$disconnect());
