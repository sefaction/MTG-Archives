import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {readCollectorDetail, readCollectorProgress, saveCollectorWishes} from "../lib/collector-service";
import {type CollectorCard} from "../lib/collector";
import {loadServerActions} from "../tests/helpers/server-actions";
import {cardHuntSnapshot, seedCardHuntFixture} from "./verify-card-hunt";
async function verifyConcurrentWishes(db: PrismaClient) {
  const name = `collector-race-${randomUUID()}`;
  const owner = await db.$transaction(async tx => {
    const player = await tx.player.create({data: {name, displayName: name}});
    const user = await tx.user.create({data: {username: name, displayName: name, passwordHash: "unused", playerId: player.id}});
    return {userId: user.id, playerId: player.id};
  });
  try {
    const catalog: CollectorCard[] = Array.from({length: 4}, (_, index) => ({
      id: `test-${index}`, oracle_id: `oracle-${index}`, name: `Card ${index}`, set: "tst",
      lang: "en", digital: false, games: ["paper"], layout: "normal", oversized: false, finishes: ["nonfoil"],
    }));
    const all = () => db.$transaction(tx => saveCollectorWishes(tx, owner, "tst", catalog, "grouped", {scope: "all"}));
    const one = () => db.$transaction(tx => saveCollectorWishes(tx, owner, "tst", catalog, "grouped",
      {scope: "one", targetId: "oracle-0"}));
    const results = await Promise.all([all(), one(), all()]);
    assert.ok(results.every(result => result.valid));
    assert.equal(results.reduce((sum, result) => sum + (result.valid ? result.added : 0), 0), 4);
    assert.equal(await db.collectorWishlistItem.count({where: {ownerUserId: owner.userId}}), 4);
  } finally {
    await db.$transaction([
      db.user.delete({where: {id: owner.userId}}),
      db.player.delete({where: {id: owner.playerId}}),
    ]);
  }
}

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
      const ownDetails = await readCollectorDetail(tx, f.user.playerId!, "tst", catalog,
        {mode: "grouped", page: 1, missingOnly: false});
      assert.deepEqual(ownDetails.progress, progress.grouped);
      assert.equal(ownDetails.rows.find(row => row.name === "Deck only")?.quantity, 1);
      assert.ok(!ownDetails.rows.some(row => row.name === "Token"));
      const missingDetails = await readCollectorDetail(tx, f.user.playerId!, "tst", catalog,
        {mode: "variants", page: 1, missingOnly: true});
      assert.deepEqual(missingDetails.progress, progress.variants);
      assert.equal(missingDetails.rows.length, 3);
      assert.equal(missingDetails.rows.find(row => row.name === "Deck only" && row.finish === "foil")?.quantity, 0);
      assert.deepEqual(await cardHuntSnapshot(tx), baseline, "Progress reads preserve all tables");
      console.log(JSON.stringify({case: "collector-postgres", tables: Object.keys(baseline).length, progress, peer, deckOwnership: "pass", tokenConservation: "pass", privacy: "pass"}));
      const owner = {userId: f.user.id, playerId: f.user.playerId!};
      const peerOwner = {userId: f.peerUser.id, playerId: f.peerUser.playerId!};
      const single = {scope: "one", targetId: `${deckOnly.scryfallId}:foil`} as const;
      await tx.wishlistItem.create({data: {ownerUserId: owner.userId, cardId: deckOnly.id, quantity: 7}});
      const wishesBaseline = await cardHuntSnapshot(tx);
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", catalog, "variants", single),
        {valid: true, added: 1, alreadySaved: 0});
      const wish = await tx.collectorWishlistItem.findFirstOrThrow({where: {ownerUserId: owner.userId, targetKey: single.targetId}});
      assert.equal(wish.preferredFinish, "foil");
      assert.equal(wish.allowOtherSets, false);
      assert.equal(wish.allowOtherFinishes, false);
      await tx.collectorWishlistItem.update({where: {id: wish.id}, data: {allowOtherSets: true, allowOtherFinishes: true}});
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", catalog, "variants", single),
        {valid: true, added: 0, alreadySaved: 1});
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", catalog, "variants", {scope: "all"}),
        {valid: true, added: 2, alreadySaved: 1});
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", catalog, "variants", {scope: "all"}),
        {valid: true, added: 0, alreadySaved: 3});
      assert.deepEqual(await saveCollectorWishes(tx, peerOwner, "tst", catalog, "variants", single),
        {valid: true, added: 0, alreadySaved: 0}, "A now-owned target is skipped for the signed-in owner");
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", catalog, "variants",
        {scope: "one", targetId: `${token.scryfallId}:foil`}), {valid: false});

      const extra = Array.from({length: 55}, (_, index) => ({
        ...catalog[0], id: `external-${index}`, oracle_id: `external-${index}`, name: `External ${index}`,
      }));
      assert.deepEqual(await saveCollectorWishes(tx, owner, "tst", [...catalog, ...extra], "grouped", {scope: "all"}),
        {valid: true, added: 55, alreadySaved: 0}, "Bulk includes targets beyond the first detail page");
      assert.deepEqual(await saveCollectorWishes(tx, peerOwner, "tst", extra, "grouped",
        {scope: "one", targetId: "external-0"}), {valid: true, added: 1, alreadySaved: 0});
      assert.equal(await tx.collectorWishlistItem.count({where: {ownerUserId: owner.userId}}), 58);
      assert.equal(await tx.collectorWishlistItem.count({where: {ownerUserId: peerOwner.userId}}), 1);
      const foreignActions = loadServerActions("app/wishlist/set-completion-actions.ts", {
        "@/lib/auth": {requireLogin: async () => f.peerUser},
        "@/lib/prisma": {prisma: tx},
        "next/cache": {revalidatePath: () => {}},
      });
      const foreignForm = new FormData();
      foreignForm.set("wishId", wish.id);
      await foreignActions.updateSetCompletionPreferences(foreignForm);
      await foreignActions.removeSetCompletionWish(foreignForm);
      const edited = await tx.collectorWishlistItem.findUniqueOrThrow({where: {id: wish.id}});
      assert.equal(edited.allowOtherSets, true);
      assert.equal(edited.allowOtherFinishes, true);
      assert.equal(edited.preferredFinish, "foil");
      assert.deepEqual({...await cardHuntSnapshot(tx), CollectorWishlistItem: wishesBaseline.CollectorWishlistItem},
        wishesBaseline, "Set Completion writes preserve every other table including manual wishes");
      throw rollback;
    }, {timeout: 60000}).catch(error => {if (error !== rollback) throw error;});
    assert.deepEqual(await cardHuntSnapshot(db), before);
    await verifyConcurrentWishes(db);
    assert.deepEqual(await cardHuntSnapshot(db), before);
    console.log("Collector actual PostgreSQL, replay, concurrent adds, and full fixture rollback passed.");
  } finally {await db.$disconnect();}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
