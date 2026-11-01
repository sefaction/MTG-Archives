import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(process.env.PHOTO_PRESSURE_SOURCE ?? new URL("../lib/acquisition-photo-pressure.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("pressure.ts", source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "purgeAcquisitionPhotosUnderPressure");
assert.ok(declaration, "Compile the complete production pressure-cleanup function");
const actual = ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  let state = Array.from({ length: options.batches ?? 1 }, (_, i) => ({
    id: "batch-" + i, ownerPlayerId: "owner", run: { id: "run-" + i },
    deletedAt: options.existing ? new Date(0) : null, marker: Boolean(options.existing),
    photo: { id: "photo-" + i, runId: "run-" + i, purgedAt: null },
  }));
  const removed = new Set();
  const sql = query => query.text ?? query.join("");
  const db = {
    $queryRaw: async query => {
      const text = sql(query);
      if (text.includes("GROUP BY")) return [{ id: "owner" }];
      if (text.includes('s."deletedAt" IS NOT NULL')) return state.filter(b => b.deletedAt && b.marker && !b.photo.purgedAt).map(b => ({ id: b.id }));
      if (text.includes('ORDER BY s."createdAt"')) return state.filter(b => !b.deletedAt).map(b => ({ id: b.id }));
      throw Error("Unexpected selection query");
    },
    acquisitionPhoto: { findMany: async ({ where }) => state.filter(b => b.run.id === where.runId && !b.photo.purgedAt).map(b => ({ ...b.photo })) },
    $transaction: async work => {
      const draft = structuredClone(state);
      let selected;
      const session = async ({ where }) => { selected = draft.find(b => b.id === where.id); return structuredClone(selected); };
      const tx = {
        $executeRaw: async () => 0,
        $queryRaw: async query => sql(query).includes("SELECT s.id") ? [{ id: selected.id }] : [],
        acquisitionSession: {
          findUnique: session, findUniqueOrThrow: session,
          update: async ({ where, data }) => Object.assign(draft.find(b => b.id === where.id), data),
        },
        scannerRun: { findMany: async () => [] },
        acquisitionProcessingJob: { updateMany: async () => ({ count: 0 }) },
        acquisitionCommand: {
          create: async ({ data }) => { draft.find(b => b.run.id === data.runId).marker = true; },
          findUnique: async ({ where }) => draft.find(b => b.run.id === where.runId_requestKey.runId)?.marker ? {} : null,
        },
        acquisitionPhoto: {
          aggregate: async () => ({ _sum: { bytes: options.usage ?? 1000 } }),
          findUnique: async ({ where }) => structuredClone(draft.find(b => b.photo.id === where.id)?.photo),
          updateMany: async ({ where, data }) => {
            const b = draft.find(b => b.photo.id === where.id && !b.photo.purgedAt);
            if (!b) return { count: 0 }; Object.assign(b.photo, data); return { count: 1 };
          },
        },
      };
      const result = await work(tx);
      if (draft.some((b, i) => !state[i].deletedAt && b.deletedAt && options.refuseExpiry?.includes(b.id)))
        throw Error("controlled expiry precommit rollback");
      if (options.refuseMark && draft.some((b, i) => !state[i].photo.purgedAt && b.photo.purgedAt))
        throw Error("controlled purge-mark precommit rollback");
      state = draft;
      return result;
    },
  };
  const run = vm.runInNewContext(actual + "\npurgeAcquisitionPhotosUnderPressure", {
    Date, Prisma: { sql: (strings, ...values) => ({ text: strings.join(""), values }), join: values => values },
    eligible: {}, PHOTO_PRESSURE_CLEANUP_KEY: "photo-pressure-cleanup", acquisitionPhotoLimits: () => ({ owner: 100 }),
    hasCorrectionRetentionPins: async () => Boolean(options.pinned),
    findAcquisitionPhotoTemporaryFiles: async ids => {
      if (options.discoveryFailure) throw Error("controlled discovery failure");
      return new Map(ids.map(id => [id, []]));
    },
    removeAcquisitionPhotoBytes: async id => { removed.add(id); },
  });
  return { run: () => run(db), state: () => state, removed, options };
}

test("a rolled-back expiry is not reported as a committed expiration", async () => {
  const f = fixture({ refuseExpiry: ["batch-0"] }), before = structuredClone(f.state());
  const result = await f.run();
  assert.equal(result.expired, 0); assert.equal(result.purged, 0); assert.equal(result.failed, 1);
  assert.deepEqual(f.state(), before); assert.equal(f.removed.size, 0);
});

test("one refused expiry does not inflate the next successful batch count", async () => {
  const f = fixture({ batches: 2, refuseExpiry: ["batch-0"] });
  const result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 1); assert.equal(result.failed, 1);
  assert.equal(f.state()[0].deletedAt, null); assert.ok(f.state()[1].deletedAt);
  assert.deepEqual([...f.removed], ["photo-1"]);
});

test("successful expiry and purge are counted once, with effect-free replay", async () => {
  const f = fixture(), first = await f.run();
  assert.equal(first.expired, 1); assert.equal(first.purged, 1); assert.equal(first.failed, 0);
  const replay = await f.run();
  assert.equal(replay.expired, 0); assert.equal(replay.purged, 0); assert.equal(replay.failed, 0);
  assert.equal(f.removed.size, 1);
});

test("previously committed expiry is not counted again during cleanup", async () => {
  const f = fixture({ existing: true }), result = await f.run();
  assert.equal(result.expired, 0); assert.equal(result.purged, 1); assert.equal(result.failed, 0);
});

test("purge-mark rollback retains one committed expiry and a retryable photo", async () => {
  const f = fixture({ refuseMark: true }), result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 0); assert.equal(result.failed, 1);
  assert.ok(f.state()[0].deletedAt); assert.ok(f.state()[0].marker); assert.equal(f.state()[0].photo.purgedAt, null);
  f.options.refuseMark = false;
  const retry = await f.run();
  assert.equal(retry.expired, 0); assert.equal(retry.purged, 1); assert.equal(retry.failed, 0);
});

test("discovery failure still reports the expiry that actually committed", async () => {
  const f = fixture({ discoveryFailure: true }), result = await f.run();
  assert.equal(result.expired, 1); assert.equal(result.purged, 0); assert.equal(result.failed, 1);
  assert.ok(f.state()[0].deletedAt); assert.equal(f.removed.size, 0);
});

for (const options of [{ pinned: true }, { usage: 80 }]) test("fresh pin/low-usage guards count no expiration: " + JSON.stringify(options), async () => {
  const f = fixture(options), result = await f.run();
  assert.equal(result.expired, 0); assert.equal(result.purged, 0); assert.equal(result.failed, 0);
  assert.equal(f.state()[0].deletedAt, null); assert.equal(f.removed.size, 0);
});
