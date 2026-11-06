import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { scannerFeedTarget, acquisitionReviewPage } from "../lib/acquisition-continuation";
import { scannerBatchSchema, scannerRunFinishSchema, scannerCanonical } from "../lib/scanner-run-protocol";
import { countedScannerSettings } from "../lib/scanner-counted-profile";
import { correctPhysicalCount, candidateKey } from "../lib/acquisition-domain";

test("internal feed bounds do not cap the logical batch or the saved-card page", () => {
  assert.equal(scannerFeedTarget(null, 150000), 500);
  assert.equal(scannerFeedTarget(150000, 5000), 500);
  assert.equal(scannerFeedTarget(150050, 150000), 50);
  assert.equal(scannerFeedTarget(150000, 150000), 0);
  assert.equal(acquisitionReviewPage("1500"), 1500);
  for (const bad of [-1, 0.5, "1e3", "Infinity", 2147483647]) assert.throws(() => acquisitionReviewPage(bad));
  assert.equal(scannerBatchSchema.parse({requestKey: randomUUID(), agentId: randomUUID(), deviceId: "counted",
    locationId: "box", section: "", quantity: 150000, loadedCount: null, settings: countedScannerSettings,
    operatorLoadedSimplexFronts: true}).quantity, 150000);
});

// Execute the actual transactional finish function. External storage/auth are
// adapters here; real PostgreSQL qualification covers their integration separately.
const source = ts.createSourceFile("scanner-runs.ts", readFileSync("lib/scanner-runs.ts", "utf8"), ts.ScriptTarget.Latest, true);
const finish = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "finishScannerRun");
assert.ok(finish);
const compiled = ts.transpileModule(finish.getText(source) + "\nexports.finish=finishScannerRun;", {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
function fixture(target: number | null = null) {
  const row: any = {id: "session", target, phase: "CAPTURING", ownerPlayerId: "owner", locationId: "box", section: "",
    run: {id: "acquisition"}, cancelledAt: null, trashedAt: null, deletedAt: null};
  const run: any = {id: randomUUID(), epoch: randomUUID(), executionId: randomUUID(), acquisitionRunId: "acquisition",
    acquisitionRun: {sessionId: row.id}, physicalTarget: 3, sequenceOffset: 5000, segment: 10,
    counted: true, status: "STARTED", outcome: null, reconciliation: null, stopRequestedAt: null,
    agentId: "agent", deviceId: "device", device: {}, settings: countedScannerSettings};
  let session: any = {run: {runId: "source"}, candidates: [0,1,2].map(index => ({
    key: candidateKey("source", `slot${index}`), input: {id: `slot${index}`, order: [5000 + index, 0]},
    revision: 0, excluded: false, countConfirmed: false, uncertainty: [], observations: [{id: `photo${index}`}],
  })), corrections: []};
  const created: any[] = [];
  const agent: any = {userId: "user", lastSeenAt: new Date(), revokedAt: null, devices: []};
  let remaining: number | null = null;
  const db: any = {
    $queryRaw: async () => [],
    scannerRun: {
      findFirstOrThrow: async () => created.at(-1) ?? run,
      update: async ({data}: any) => { Object.assign(run, data); return run; },
      create: async ({data}: any) => { created.push(data); return data; },
    },
    acquisitionPhoto: {findMany: async () => [0,1,2].map(i => ({ready: true, slotId: `slot${i}`, slot: {position: 5000+i}}))},
    acquisitionSession: {update: async ({data}: any) => {Object.assign(row, data);}},
    acquisitionCandidate: {count: async () => 5003},
    scannerAgent: {findUniqueOrThrow: async () => agent},
  };
  const exports: any = {};
  new Script(compiled).runInNewContext({exports, scannerRunFinishSchema, scannerCanonical, scannerFeedTarget, randomUUID,
    scannerTransaction: async (_: unknown, work: any) => work(db),
    agentRun: async () => ({run: {...run}, actor: {userId: "user", adminMode: false}}),
    lockScannerSeries: async () => ({root: {seriesStoppedAt: null}}),
    readAcquisitionRow: async () => ({...row}),
    getStartState: async () => ({session}), hydrateAcquisitionRow: () => ({destinationCurrent: true}),
    saveAcquisitionRow: async (_tx: unknown, _row: unknown, _before: unknown, after: any) => {session = after;},
    correctPhysicalCount, candidateKey,
    scannerDeviceSchema: {array: () => ({safeParse: () => ({success: true, data: [{id: "device", qualification: "KnownWorking"}]})})},
    isCountedScannerDevice: () => true,
    readScannerCapacity: async () => ({remaining}),
    denied: () => Error("denied"), ScannerRunConflict: Error,
  });
  const outcome: any = {outcome: "COMPLETED", imageCount: 3, elapsedMs: 1000,
    knownPhysicalItems: null, sourceExhausted: "UNKNOWN", nativeError: null};
  const call = () => exports.finish(db, "credential", {version: 1, runId: run.id, epoch: run.epoch,
    executionId: run.executionId, outcome}, run.epoch);
  return {row, run, agent, created, outcome, call, setRemaining: (n: number) => {remaining = n;}};
}

test("clean internal completion crosses the former sequence cap without a new logical batch", async () => {
  const f = fixture(); await f.call();
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].acquisitionRunId, f.run.acquisitionRunId);
  assert.equal(f.created[0].sequenceOffset, 5003);
  assert.equal(f.created[0].physicalTarget, 500);
  assert.equal(f.created[0].deviceId, f.run.deviceId);
  assert.equal(f.row.phase, "CAPTURING");
  await f.call(); assert.equal(f.created.length, 1, "finish replay must never authorize another feed");
  assert.equal(f.row.phase, "CAPTURING", "old finish replay must not pause the new feed");
});

test("the final requested count completes without another feed", async () => {
  const f = fixture(5003); await f.call();
  assert.equal(f.created.length, 0); assert.equal(f.row.phase, "COMPLETE");
});

for (const [name, change] of [
  ["Stop", (f: ReturnType<typeof fixture>) => { f.run.stopRequestedAt = new Date(); }],
  ["empty feeder", (f: ReturnType<typeof fixture>) => { f.outcome.sourceExhausted = "REPORTED_EMPTY"; }],
  ["scanner error", (f: ReturnType<typeof fixture>) => { f.outcome.outcome = "ERROR"; }],
  ["revoked connection", (f: ReturnType<typeof fixture>) => { f.agent.revokedAt = new Date(); }],
  ["stale helper", (f: ReturnType<typeof fixture>) => { f.agent.lastSeenAt = new Date(0); }],
  ["capacity reduction", (f: ReturnType<typeof fixture>) => { f.setRemaining(5003); }],
] as const) test(`${name} cannot automatically authorize another feed`, async () => {
  const f = fixture(); change(f); await f.call(); assert.equal(f.created.length, 0);
});
