import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { scannerCredential, scannerHash, scannerHashMatches, scannerPairClaimSchema, scannerPairCode,
  scannerPulseSchema, scannerSecret } from "../lib/scanner-protocol";
import { scannerRetentionSchema, scannerRefillObservationIsSafe, scannerRefillReconciliationIsSafe } from "../lib/scanner-run-protocol";
import { readScannerJson } from "../lib/scanner-http";
const device = { id: "source", name: "Scanner", backend: "generic", source: "Wia", qualification: "GenericUnqualified" };
test("refill accepts an empty hopper or accounted reload, never uncertain physical transport", () => {
  const runId = randomUUID();
  const empty = { runId, cardsEmitted: 0, feederEmpty: true, remainingCards: 0,
    transportEmpty: true, eachImageIsOneCardFront: true, noJamOrDouble: true, remainingWhollyInHopper: true };
  const loaded = { ...empty, feederEmpty: false, remainingCards: 10 };
  assert.equal(scannerRefillObservationIsSafe(empty, runId), true);
  assert.equal(scannerRefillObservationIsSafe(loaded, runId), true);
  for (const value of [null, {}, { ...loaded, runId: randomUUID() }, { ...loaded, transportEmpty: false },
    { ...loaded, noJamOrDouble: false }, { ...loaded, eachImageIsOneCardFront: false },
    { ...loaded, remainingWhollyInHopper: false }, { ...loaded, remainingCards: 0 },
    { ...loaded, remainingCards: 501 }, { ...loaded, feederEmpty: true }])
    assert.equal(scannerRefillObservationIsSafe(value, runId), false);
});
test("automatic counted refill requires the qualified image-count basis and matching saved total", () => {
  const runId = randomUUID();
  const receipt = {mode:"SCANNER_IMAGE_COUNT",basis:"QUALIFIED_COUNTED_FRONT_IMAGES",imageCount:10};
  assert.equal(scannerRefillReconciliationIsSafe(receipt,runId,10),true);
  assert.equal(scannerRefillReconciliationIsSafe({...receipt,imageCount:0},runId,0),true);
  for (const value of [null, {}, {...receipt,basis:undefined}, {...receipt,basis:"OPERATOR"},
    {...receipt,mode:"CANCELLED_WITHOUT_START"}, {...receipt,imageCount:9}])
    assert.equal(scannerRefillReconciliationIsSafe(value,runId,10),false);
});
test("scanner credentials require exact identity/entropy and hashes contain no secret", () => {
  const id = randomUUID(), secret = scannerSecret();
  assert.equal(secret.length, 43);
  assert.deepEqual(scannerCredential(`Bearer ${id}.${secret}`), { id, secret });
  for (const value of [`${id}.${secret}`, `Bearer ${id}.short`, `Bearer ${id}.${secret}.extra`, "Bearer invalid"])
    assert.equal(scannerCredential(value), null);
  assert.equal(scannerHashMatches(secret, scannerHash(secret)), true);
  assert.equal(scannerHashMatches(scannerSecret(), scannerHash(secret)), false);
  assert.equal(scannerHashMatches(secret, "corrupt"), false);
  assert.deepEqual(scannerPairCode(`${id}.${secret}`), { id, secret });
  assert.throws(() => scannerPairCode(`${id}.short`));
});
test("device report cannot inject credentials, commands, duplicate IDs or unbounded sources", () => {
  const pulse = { version: 1, agentVersion: "test", devices: [device] };
  assert.ok(scannerPulseSchema.safeParse(pulse).success);
  for (const value of [{ ...pulse, userId: "forged" }, { ...pulse, commands: ["START"] },
    { ...pulse, devices: [device, device] }, { ...pulse, devices: [{ ...device, token: "private" }] },
    { ...pulse, devices: Array.from({ length: 33 }, (_, n) => ({ ...device, id: String(n) })) },
    { ...pulse, version: 2 }]) assert.equal(scannerPulseSchema.safeParse(value).success, false);
  assert.equal(scannerPairClaimSchema.safeParse({ version: 1, pairCode: "x", agentId: randomUUID(),
    secret: scannerSecret(), name: "helper", userId: "forged" }).success, false);
});
test("optional discovery reports are bounded diagnostics and preserve old helper pulses", () => {
  const pulse = { version:1,agentVersion:"fixture",devices:[device] };
  const issue = {source:"Twain",code:"DISCOVERY_FAILED",retryAfterSeconds:30};
  assert.ok(scannerPulseSchema.safeParse(pulse).success);
  assert.ok(scannerPulseSchema.safeParse({...pulse,discoveryIssues:[issue]}).success);
  assert.ok(scannerPulseSchema.safeParse({...pulse,discoveryIssues:[{...issue,code:"DISCOVERY_RESTART_REQUIRED",retryAfterSeconds:null}]}).success);
  assert.ok(scannerPulseSchema.safeParse({...pulse,discoveryIssues:[{source:"Windows",code:"DISCOVERY_IN_PROGRESS",retryAfterSeconds:null}]}).success);
  assert.equal(scannerPulseSchema.safeParse({...pulse,discoveryIssues:[{...issue,code:"DISCOVERY_IN_PROGRESS"}]}).success,false);
  for(const issues of [[issue,issue],[{...issue,source:"private/path"}],[{...issue,token:"private"}],
    [{...issue,message:"native driver details"}],[{...issue,retryAfterSeconds:301}],
    [{...issue,code:"START"}],Array.from({length:9},(_,n)=>({...issue,source:`source${n}`}))])
    assert.equal(scannerPulseSchema.safeParse({...pulse,discoveryIssues:issues}).success,false);
});
test("scanner JSON bounds chunked requests before accumulating oversized bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(10)); controller.enqueue(new Uint8Array(10));
  }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(readScannerJson(request, 15), /too large/);
  assert.equal(cancelled, true);
  assert.deepEqual(await readScannerJson(new Request("http://localhost", { method: "POST", body: '{"version":1}' }), 100), { version: 1 });
});
test("scanner original cleanup request binds a bounded set of exact photo digests", () => {
  const artifact = { artifactId: randomUUID(), photoId: randomUUID(), digest: "a".repeat(64) };
  const request = { version: 1, runId: randomUUID(), epoch: randomUUID(), artifacts: [artifact] };
  assert.ok(scannerRetentionSchema.safeParse(request).success);
  for (const bad of [{ ...request, artifacts: [artifact, artifact] },
    { ...request, artifacts: [{ ...artifact, digest: "bad" }] },
    { ...request, artifacts: [{ ...artifact, path: "private" }] },
    { ...request, artifacts: Array.from({ length: 501 }, () => ({ ...artifact, artifactId: randomUUID() })) }])
    assert.equal(scannerRetentionSchema.safeParse(bad).success, false);
});
