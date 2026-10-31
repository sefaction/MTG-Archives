import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(process.env.PHOTO_TRASH_SOURCE ?? new URL("../lib/acquisition-photo-retention.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("retention.ts", source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "purgeTrashedAcquisitionPhotos");
assert.ok(declaration, "Compile the complete production cleanup function");
const actual = ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const now = new Date("2026-10-30T12:00:00Z");

async function fixture(check, count = 1) {
  const parent = path.resolve(".local-data");
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "trash-commit-"));
  const batches = Array.from({ length: count }, (_, i) => ({
    id: "batch-" + i, run: { id: "run-" + i }, deletedAt: null,
    trashedAt: new Date(now.getTime() - 8 * 86400000),
    trashExpiresAt: new Date(now.getTime() - 86400000), phase: "CANCELLED", scannerReserved: 0,
  }));
  const photos = batches.map((b, i) => ({ id: "photo-" + i, runId: b.run.id, purgedAt: null }));
  let state = structuredClone({ batches, photos });
  const faults = {}, events = [];
  let transactions = 0, removes = 0;
  const original = Buffer.from("owned synthetic original");
  const file = id => path.join(root, id + ".original");
  for (const p of photos) await fsp.writeFile(file(p.id), original);
  await fsp.writeFile(file("peer"), original);
  const db = {
    $queryRaw: async () => state.batches.map(b => ({ id: b.id })),
    acquisitionPhoto: { findMany: async ({ where }) => state.photos.filter(p => p.runId === where.runId && p.purgedAt === null) },
    $transaction: async work => {
      const number = ++transactions;
      const draft = structuredClone(state);
      const tx = {
        $queryRaw: async () => [],
        acquisitionSession: {
          findUnique: async ({ where }) => draft.batches.find(b => b.id === where.id),
          findUniqueOrThrow: async ({ where }) => { const b = draft.batches.find(b => b.id === where.id); assert.ok(b); return b; },
          update: async ({ where, data }) => { const b = draft.batches.find(b => b.id === where.id); Object.assign(b, data); events.push("expiry-write"); return b; },
        },
        scannerRun: { count: async () => faults.draining ? 1 : 0 },
        acquisitionPhoto: {
          findMany: async ({ where }) => draft.photos.filter(p => p.runId === where.runId && p.purgedAt === null),
          findUnique: async ({ where }) => draft.photos.find(p => p.id === where.id),
          update: async ({ where, data }) => { const p = draft.photos.find(p => p.id === where.id); Object.assign(p, data); return p; },
          updateMany: async ({ where, data }) => {
            const p = draft.photos.find(p => p.id === where.id && p.purgedAt === null && (!where.runId || p.runId === where.runId));
            if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 };
          },
        },
      };
      const result = await work(tx);
      if (faults.commit?.(number, draft)) { events.push("rollback"); throw Error("controlled commit refusal"); }
      state = draft;
      events.push("commit");
      await faults.afterCommit?.(number, state);
      return result;
    },
  };
  const run = vm.runInNewContext(actual + "\npurgeTrashedAcquisitionPhotos", {
    Date, BATCH_TRASH_DAYS: 7, settledScannerTransfer: {},
    hasCorrectionRetentionPins: async () => Boolean(faults.pinned),
    findAcquisitionPhotoTemporaryFiles: async ids => {
      if (faults.discovery) throw Error("controlled discovery failure");
      return new Map(ids.map(id => [id, []]));
    },
    removeAcquisitionPhotoBytes: async id => {
      removes++;
      events.push("unlink");
      if (faults.requireDurable) assert.ok(state.batches.find(b => b.run.id === state.photos.find(p => p.id === id).runId).deletedAt,
        "Expiry must already be committed before the first unlink");
      if (faults.unlink) throw Error("controlled unlink failure");
      await fsp.rm(file(id), { force: true });
    },
  });
  try {
    await check({ run: () => run(db, now), faults, events, file, original,
      state: () => state, removes: () => removes });
    assert.deepEqual(await fsp.readFile(file("peer")), original);
  } finally {
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith("trash-commit-"));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("expiry is durably committed before any original is removed", () => fixture(async f => {
  f.faults.requireDurable = true;
  const result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 1); assert.equal(result.failed, 0);
  assert.ok(f.events.indexOf("commit") < f.events.indexOf("unlink"));
}));

test("failed expiry commit preserves bytes and continues the next batch", () => fixture(async f => {
  f.faults.commit = number => number === 1;
  const result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 1); assert.equal(result.failed, 1);
  assert.equal(f.state().batches[0].deletedAt, null);
  assert.deepEqual(await fsp.readFile(f.file("photo-0")), f.original);
  assert.ok(f.state().batches[1].deletedAt);
}, 2));

test("failed photo commit retains expiry, reports no purge, and retries missing bytes", () => fixture(async f => {
  f.faults.commit = (_number, draft) => draft.photos[0].purgedAt !== null;
  const first = await f.run();
  assert.equal(first.expired, 1); assert.equal(first.purged, 0); assert.equal(first.failed, 1);
  assert.ok(f.state().batches[0].deletedAt); assert.equal(f.state().photos[0].purgedAt, null);
  await assert.rejects(fsp.access(f.file("photo-0")));
  delete f.faults.commit;
  const retry = await f.run();
  assert.equal(retry.expired, 0); assert.equal(retry.purged, 1); assert.equal(retry.failed, 0);
  assert.ok(f.state().photos[0].purgedAt);
}));

test("a correction pin acquired after expiry prevents file removal", () => fixture(async f => {
  f.faults.afterCommit = () => { f.faults.pinned = true; };
  const result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 0); assert.equal(result.failed, 0);
  assert.equal(f.removes(), 0);
  assert.deepEqual(await fsp.readFile(f.file("photo-0")), f.original);
}));

for (const condition of ["pinned", "draining"]) test(condition + " batches remain untouched", () => fixture(async f => {
  f.faults[condition] = true;
  const result = await f.run();
  assert.equal(result.expired, 0); assert.equal(result.purged, 0); assert.equal(result.failed, 0);
  assert.equal(f.removes(), 0); assert.equal(f.state().batches[0].deletedAt, null);
}));

test("discovery failure keeps durable expiry and leaves bytes for retry", () => fixture(async f => {
  f.faults.discovery = true;
  const result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 0); assert.equal(result.failed, 1);
  assert.ok(f.state().batches[0].deletedAt); assert.equal(f.removes(), 0);
  delete f.faults.discovery;
  assert.equal((await f.run()).purged, 1);
}));

test("unlink failure keeps rows pending and permits an effect-free later replay", () => fixture(async f => {
  f.faults.unlink = true;
  const first = await f.run();
  assert.equal(first.expired, 1); assert.equal(first.purged, 0); assert.equal(first.failed, 1);
  assert.ok(f.state().batches[0].deletedAt); assert.equal(f.state().photos[0].purgedAt, null);
  delete f.faults.unlink;
  assert.equal((await f.run()).purged, 1);
  const removes = f.removes();
  assert.equal((await f.run()).purged, 0); assert.equal(f.removes(), removes);
}));

for (const field of ["trashedAt", "trashExpiresAt"]) test("a selected batch with future " + field + " is rechecked", () => fixture(async f => {
  f.state().batches[0][field] = new Date(now.getTime() + 86400000);
  const result = await f.run();
  assert.equal(result.expired, 0); assert.equal(result.purged, 0); assert.equal(result.failed, 0);
  assert.equal(f.removes(), 0); assert.equal(f.state().batches[0].deletedAt, null);
  assert.deepEqual(await fsp.readFile(f.file("photo-0")), f.original);
}));

for (const change of ["missing-session", "different-run", "missing-expiry", "different-photo-run"]) {
  test("cleanup rechecks " + change + " after committing expiry", () => fixture(async f => {
    f.faults.afterCommit = number => {
      if (number !== 1) return;
      const state = f.state();
      if (change === "missing-session") state.batches.length = 0;
      if (change === "different-run") state.batches[0].run.id = "replacement-run";
      if (change === "missing-expiry") state.batches[0].deletedAt = null;
      if (change === "different-photo-run") state.photos[0].runId = "replacement-run";
    };
    const result = await f.run();
    assert.equal(result.expired, 1); assert.equal(result.purged, 0); assert.equal(result.failed, 0);
    assert.equal(f.removes(), 0);
    assert.deepEqual(await fsp.readFile(f.file("photo-0")), f.original);
  }));
}
