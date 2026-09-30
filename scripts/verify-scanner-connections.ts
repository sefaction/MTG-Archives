import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createScannerPairing, claimScannerPairing, recordScannerPulse, listScannerAgents,
  revokeScannerAgent } from "../lib/scanner-store";
import { scannerHash, scannerSecret } from "../lib/scanner-protocol";

// Invoked only inside the guarded, disposable acquisition database verifier.
export async function verifyScannerConnections(db: PrismaClient) {
  const tag = `scanner-${randomUUID()}`, owner = `${tag}-owner`, other = `${tag}-other`;
  const now = new Date();
  const pulse = { version: 1, agentVersion: "fixture", devices: [{ id: "fixture-wia", name: "Fixture scanner",
    backend: "fixture", source: "Wia", qualification: "GenericUnqualified" }] };
  const ids = [owner, other];
  try {
    for (const id of ids) {
      await db.player.create({ data: { id, name: id, displayName: id } });
      await db.user.create({ data: { id, username: id, displayName: id, playerId: id, passwordHash: "fixture-not-login" } });
    }
    const pair = await createScannerPairing(db, owner, now);
    const agentId = randomUUID(), secret = scannerSecret();
    const claim = { version: 1, pairCode: pair.code, agentId, secret, name: "Scanner fixture" };
    const [first, replay] = await Promise.all([claimScannerPairing(db, claim, now), claimScannerPairing(db, claim, now)]);
    assert.deepEqual(replay, first); // Concurrent/lost ACK enrollment is one identity.
    assert.equal(await db.scannerAgent.count({ where: { userId: owner } }), 1);
    const saved = await db.scannerAgent.findUniqueOrThrow({ where: { id: agentId } });
    assert.equal(saved.tokenHash, scannerHash(secret));
    assert.ok(!JSON.stringify(saved).includes(secret));
    await assert.rejects(claimScannerPairing(db, { ...claim, secret: scannerSecret() }, now));
    await assert.rejects(claimScannerPairing(db, { ...claim, agentId: randomUUID() }, now));
    await assert.rejects(claimScannerPairing(db, claim, new Date(pair.expiresAt.getTime() + 1)));
    const authorization = `Bearer ${agentId}.${secret}`;
    await assert.rejects(recordScannerPulse(db, `Bearer ${agentId}.${scannerSecret()}`, pulse, now));
    await recordScannerPulse(db, authorization, pulse, now);
    const issue = {source:"Twain",code:"DISCOVERY_FAILED",retryAfterSeconds:30};
    const acknowledgement = await recordScannerPulse(db,authorization,{...pulse,discoveryIssues:[issue]},now);
    assert.equal(acknowledgement.discoveryReporting,true);
    assert.deepEqual((await listScannerAgents(db,owner,now))[0].discoveryIssues,[issue]);
    // Older helper/native-run pulses keep the last explicit diagnostic snapshot.
    await recordScannerPulse(db,authorization,pulse,now);
    assert.deepEqual((await listScannerAgents(db,owner,now))[0].discoveryIssues,[issue]);
    await assert.rejects(recordScannerPulse(db,`Bearer ${agentId}.${scannerSecret()}`,{...pulse,discoveryIssues:[]},now));
    assert.deepEqual((await listScannerAgents(db,owner,now))[0].discoveryIssues,[issue]);
    await recordScannerPulse(db,authorization,{...pulse,discoveryIssues:[]},now);
    assert.deepEqual((await listScannerAgents(db,owner,now))[0].discoveryIssues,[]);
    const visible = await listScannerAgents(db, owner, now);
    assert.equal(visible[0].online, true);
    assert.equal(visible[0].devices[0].id, "fixture-wia");
    assert.ok(!JSON.stringify(visible).includes(secret));
    assert.ok(!JSON.stringify(visible).includes(saved.tokenHash));
    assert.deepEqual(await listScannerAgents(db, other, now), []);
    assert.equal((await listScannerAgents(db, owner, new Date(now.getTime() + 30001)))[0].online, false);
    await assert.rejects(revokeScannerAgent(db, other, agentId, now));
    await db.user.update({ where: { id: owner }, data: { passwordHash: "fixture-password-changed" } });
    await assert.rejects(recordScannerPulse(db, authorization, pulse, now));
    await assert.rejects(claimScannerPairing(db, claim, now));
    assert.deepEqual(await listScannerAgents(db, owner, now), []);
    await db.user.update({ where: { id: owner }, data: { passwordHash: "fixture-not-login" } });
    await db.user.update({ where: { id: owner }, data: { isActive: false } });
    await assert.rejects(recordScannerPulse(db, authorization, pulse, now));
    await db.user.update({ where: { id: owner }, data: { isActive: true } });
    await db.player.update({ where: { id: owner }, data: { active: false } });
    await assert.rejects(recordScannerPulse(db, authorization, pulse, now));
    await db.player.update({ where: { id: owner }, data: { active: true } });
    await revokeScannerAgent(db, owner, agentId, now);
    await assert.rejects(recordScannerPulse(db, authorization, pulse, now));
    await assert.rejects(claimScannerPairing(db, claim, now));
    const expired = await createScannerPairing(db, owner, now);
    await assert.rejects(claimScannerPairing(db, { ...claim, pairCode: expired.code, agentId: randomUUID() },
      new Date(expired.expiresAt.getTime() + 1)));
    assert.equal(await db.acquisitionSession.count({ where: { createdByUserId: { in: ids } } }), 0);
    assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: { in: ids } } }), 0);
    console.log("PASS: scanner concurrent pairing/replay, secret redaction, owner/revocation/expiry/password/active fences and device status; no scans or Inventory");
  } finally {
    await db.scannerPairing.deleteMany({ where: { userId: { in: ids } } });
    await db.scannerAgent.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.player.deleteMany({ where: { id: { in: ids } } });
  }
}
