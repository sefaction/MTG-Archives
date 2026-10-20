import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { scannerCapacityDestinations, readScannerCapacity } from "../lib/scanner-capacity";
import { getStorageLocations } from "../lib/storage-summary";
import { scanLocationHasRoom, scanSectionHasRoom } from "../lib/scan-destination-filter";

// Run only inside the externally identity/label/network/mount-verified disposable
// fixture. A normal primary/review DATABASE_URL cannot satisfy this name fence.
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    !/^acquisition_filter_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    !process.env.MTG_ISOLATED_QUALIFICATION_RUN?.match(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)) {
  throw new Error("Requires an owned disposable acquisition_filter_* qualification database");
}

const db = new PrismaClient();
const tag = `scan-filter-${randomUUID()}`;
const rollback = new Error("ROLLBACK_SCOPED_SCAN_FILTER_FIXTURE");

async function verify() {
  try {
    await db.$transaction(async tx => {
      await tx.player.create({ data: { id: tag, name: tag, displayName: tag } });
      await tx.user.create({ data: { id: tag, username: tag, displayName: tag,
        playerId: tag, passwordHash: "fixture-not-a-login-hash" } });
      const box = await tx.inventoryLocation.create({ data: { id: tag, name: tag,
        normalizedName: tag, ownerPlayerId: tag, storageLayout: { capacity: 11, sections: [
          { name: "A", capacity: 5 }, { name: "B", capacity: 3 }, { name: "Unknown", capacity: null },
        ] } } });
      const card = await tx.card.create({ data: { id: tag, scryfallId: randomUUID(),
        name: tag, typeLine: "Basic Land", setCode: "tst", collectorNumber: "1", rarity: "common" } });
      const stock = await tx.inventoryItem.create({ data: { cardId: card.id, currentOwnerId: tag,
        locationId: box.id, locationSection: "A", quantity: 1, condition: "NM", sourceType: "MANUAL" } });
      const vault = await tx.inventoryLocation.create({ data: { id: tag + "-vault", name: tag + "-vault",
        normalizedName: tag + "-vault", ownerPlayerId: tag, type: "Vault" } });
      await tx.inventoryItem.createMany({ data: [
        { cardId: card.id, currentOwnerId: tag, locationId: vault.id, locationSection: "Sect 0", quantity: 84, condition: "NM", sourceType: "MANUAL" },
        { cardId: card.id, currentOwnerId: tag, locationId: vault.id, locationSection: "Sect 1", quantity: 85, condition: "NM", sourceType: "MANUAL" },
      ] });
      const unknown = await tx.inventoryLocation.create({ data: { id: tag + "-unknown", name: tag + "-unknown",
        normalizedName: tag + "-unknown", ownerPlayerId: tag, storageLayout: { capacity: null,
          sections: [{ name: "Unknown", capacity: null }] } } });
      const foreignOwner = tag + "-foreign";
      await tx.player.create({ data: { id: foreignOwner, name: foreignOwner, displayName: foreignOwner } });
      const foreign = await tx.inventoryLocation.create({ data: { id: foreignOwner, name: foreignOwner,
        normalizedName: foreignOwner, ownerPlayerId: foreignOwner, storageLayout: { capacity: 100, sections: [] } } });
      await tx.acquisitionSession.create({ data: { createdByUserId: tag, ownerPlayerId: foreignOwner,
        locationId: foreign.id, section: "", requestKey: randomUUID(), requestPayload: "fixture",
        placement: {}, policy: {}, scannerReserved: 100 } });
      const agent = await tx.scannerAgent.create({ data: { id: tag, userId: tag,
        tokenHash: tag, credentialHash: "fixture-only", name: tag, expiresAt: new Date(Date.now() + 60000) } });

      async function session(input: { section: string; reserved: number; candidates?: number;
        slots?: number; committed?: number; trashed?: boolean; deleted?: boolean; status?: string }) {
        const created = await tx.acquisitionSession.create({ data: {
          createdByUserId: tag, ownerPlayerId: tag, locationId: box.id, section: input.section,
          requestKey: randomUUID(), requestPayload: "fixture", placement: {}, policy: {},
          scannerReserved: input.reserved,
          trashedAt: input.trashed ? new Date() : null, deletedAt: input.deleted ? new Date() : null,
          run: { create: { sourceRunId: randomUUID(), providerId: "fixture",
            enforcement: "LOGICAL_ALLOCATION", controls: [] } },
        }, include: { run: true } });
        const runId = created.run!.id;
        const candidates = [];
        for (let index = 0; index < (input.candidates ?? 0); index++) {
          candidates.push(await tx.acquisitionCandidate.create({ data: { runId,
            physicalId: randomUUID(), identityKind: "DETECTION", acquisitionOrder: index,
            spatialOrder: 0, expectedSides: ["FRONT"], provisional: false, uncertainty: [], revision: 0 } }));
        }
        for (let index = 0; index < (input.slots ?? 0); index++) {
          await tx.acquisitionCaptureSlot.create({ data: { runId, requestKey: randomUUID(), position: index } });
        }
        if (input.committed) {
          const receipt = await tx.acquisitionCommit.create({ data: { runId, actorUserId: tag,
            requestKey: randomUUID(), requestDigest: "fixture", snapshot: {} } });
          for (const candidate of candidates.slice(0, input.committed)) {
            await tx.acquisitionCommitMember.create({ data: { candidateId: candidate.id, runId,
              commitId: receipt.id, inventoryItemId: stock.id, snapshot: {} } });
          }
        }
        if (input.status) await tx.scannerRun.create({ data: { id: randomUUID(), agentId: agent.id,
          acquisitionRunId: runId, epoch: randomUUID(), requestPayload: "fixture", deviceId: "fixture",
          device: {}, settings: {}, status: input.status } });
      }

      await session({ section: " A ", reserved: 5, candidates: 3, slots: 4, committed: 1 }); // 4 held
      await session({ section: "", reserved: 2 });
      await session({ section: "Pending custom", reserved: 1 });
      await session({ section: "", reserved: 1, trashed: true, status: "QUEUED" });
      await session({ section: "", reserved: 1, deleted: true, status: "ERROR" }); // Unknown transfer retained.
      await session({ section: "", reserved: 100, trashed: true, status: "DRAINED" }); // Settled excluded.
      await session({ section: "", reserved: 100, trashed: true }); // No unfinished transfer excluded.

      const destinations = await getStorageLocations(tx, [box, vault, unknown]);
      const [snapshot, vaultSnapshot, unknownSnapshot] = await scannerCapacityDestinations(tx, destinations);
      assert.equal(snapshot.quantity, 1);
      assert.equal(snapshot.pendingQuantity, 9);
      assert.deepEqual(snapshot.sections.map(section => section.name), destinations[0].sections.map(section => section.name));
      assert.equal(snapshot.sections.find(section => section.name === "A")!.pendingQuantity, 4);
      assert.equal(scanLocationHasRoom(snapshot), true); // One slot qualifies even with ten incoming.
      assert.deepEqual(snapshot.sections.filter(section => scanSectionHasRoom(snapshot, section)).map(section => section.name), ["B"]);
      const authoritativeA = await readScannerCapacity(tx, { locationId: box.id, ownerPlayerId: tag, section: "A" });
      const authoritativeB = await readScannerCapacity(tx, { locationId: box.id, ownerPlayerId: tag, section: "B" });
      assert.equal(authoritativeA.pendingTotal, snapshot.pendingQuantity);
      assert.equal(authoritativeA.pendingSection, 4);
      assert.equal(authoritativeA.remaining, 0);
      assert.equal(authoritativeB.remaining, 1);
      assert.equal(scanLocationHasRoom(vaultSnapshot), true);
      assert.equal(vaultSnapshot.capacity, null);
      assert.equal(scanSectionHasRoom(vaultSnapshot, vaultSnapshot.sections.find(section => section.name === "Sect 0")!), true);
      assert.equal(scanSectionHasRoom(vaultSnapshot, vaultSnapshot.sections.find(section => section.name === "Sect 1")!), false);
      assert.equal(scanLocationHasRoom(unknownSnapshot), false);
      assert.equal(scanSectionHasRoom(unknownSnapshot, unknownSnapshot.sections[0]), false);
      assert.equal((await readScannerCapacity(tx, { locationId: unknown.id, ownerPlayerId: tag, section: "Unknown" })).remaining, null);
      assert.equal((await readScannerCapacity(tx, { locationId: vault.id, ownerPlayerId: tag, section: "Sect 0" })).remaining, 1);

      // Sequential stale-snapshot control, not a concurrency claim. It cannot
      // silently change the client's selected values; the browser checks that.
      await tx.inventoryItem.update({ where: { id: stock.id }, data: { quantity: 2 } });
      const [full] = await scannerCapacityDestinations(tx, await getStorageLocations(tx, [box]));
      assert.equal(scanLocationHasRoom(full), false);
      assert.equal(full.sections.some(section => scanSectionHasRoom(full, section)), false);
      await tx.inventoryItem.update({ where: { id: stock.id }, data: { quantity: 3 } });
      const [over] = await scannerCapacityDestinations(tx, await getStorageLocations(tx, [box]));
      assert.equal(scanLocationHasRoom(over), false);
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await db.player.count({ where: { id: tag } }), 0);
  assert.equal(await db.player.count({ where: { id: tag + "-foreign" } }), 0);
  assert.equal(await db.user.count({ where: { id: tag } }), 0);
  assert.equal(await db.inventoryLocation.count({ where: { id: tag } }), 0);
  assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: tag } }), 0);
  assert.equal(await db.acquisitionSession.count({ where: { ownerPlayerId: tag } }), 0);
  console.log("PASS scoped actual-Prisma capacity list/authoritative parity, reservations/receipts, unresolved transfers, full/over and rollback cleanup");
}

verify().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
