import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {readCollectorProgress} from "../lib/collector-service";
import {type CollectorCard} from "../lib/collector";
import {cardHuntSnapshot, seedCardHuntFixture} from "./verify-card-hunt";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (process.env.MTG_LOCAL_PILOT_TEST !== "1" || !["127.0.0.1", "localhost", "mtg-collector-1010-db"].includes(url.hostname) || !/^\/(?:collector_1010|import_integrity)$/.test(url.pathname))
    throw Error("Use only the explicit disposable Collector database");
  const db = new PrismaClient(); const rollback = new Error("EXPECTED_ROLLBACK");
  try {
    const before = await cardHuntSnapshot(db);
    await db.$transaction(async tx => {
      const f = await seedCardHuntFixture(tx, `collector-${randomUUID()}`);
      const catalog: CollectorCard[] = f.cards.map(c => ({id: c.scryfallId, oracle_id: c.oracleId!, name: c.name,
        set: "tst", lang: "en", digital: false, games: ["paper"], layout: "normal", type_line: "Artifact", oversized: false, finishes: ["foil", "nonfoil"]}));
      const deckOnly = await tx.card.create({data: {scryfallId: randomUUID(), oracleId: randomUUID(), name: "Deck only", setCode: "tst", collectorNumber: "5", typeLine: "Creature", rarity: "common"}});
      const token = await tx.card.create({data: {scryfallId: randomUUID(), name: "Token", setCode: "tst", collectorNumber: "6", typeLine: "Token Creature", rarity: "common"}});
      catalog.push({...catalog[0], id: deckOnly.scryfallId, oracle_id: deckOnly.oracleId!, name: "Deck only"},
        {...catalog[0], id: token.scryfallId, name: "Token", layout: "token"});
      await tx.inventoryItem.createMany({data: [
        {currentOwnerId: f.user.playerId!, cardId: deckOnly.id, quantity: 1, condition: "NM", language: "EN", foilStatus: "NONFOIL", locationId: f.locations[4].id},
        {currentOwnerId: f.user.playerId!, cardId: token.id, quantity: 150000, condition: "NM", language: "EN", foilStatus: "NONFOIL"},
        {currentOwnerId: f.peerUser.playerId!, cardId: deckOnly.id, quantity: 99, condition: "NM", language: "EN", foilStatus: "FOIL"},
      ]});
      const baseline = await cardHuntSnapshot(tx);
      const progress = await readCollectorProgress(tx, f.user.playerId!, "tst", catalog);
      assert.deepEqual(progress.grouped, {owned: 5, total: 5, percent: 100});
      assert.deepEqual(progress.variants, {owned: 7, total: 10, percent: 70});
      const peer = await readCollectorProgress(tx, f.peerUser.playerId!, "tst", catalog);
      assert.equal(peer.grouped.owned, 1); assert.equal(peer.variants.owned, 1);
      const unknown = await readCollectorProgress(tx, "no-such-owner", "tst", catalog);
      assert.equal(unknown.grouped.owned, 0);
      await assert.rejects(readCollectorProgress(tx, "", "tst", catalog));
      assert.deepEqual(await cardHuntSnapshot(tx), baseline, "Progress reads preserve all tables");
      console.log(JSON.stringify({case: "collector-postgres", tables: Object.keys(baseline).length, progress, peer, deckOwnership: "pass", tokenConservation: "pass", privacy: "pass"}));
      throw rollback;
    }, {timeout: 60000}).catch(error => {if (error !== rollback) throw error;});
    assert.deepEqual(await cardHuntSnapshot(db), before);
    console.log("Collector actual PostgreSQL and full fixture rollback passed.");
  } finally {await db.$disconnect();}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
