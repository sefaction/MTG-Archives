import test from "node:test";
import assert from "node:assert/strict";
import fs, { constants } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { z } from "zod";

function declarations(file, required, optional = []) {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true);
  return [...required, ...optional].map(name => {
    const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    if (!node) { assert.ok(optional.includes(name), "Complete actual function: " + name); return ""; }
    return ts.transpileModule(node.getText(tree).replace(/^export\s+/, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }).join("\n");
}
const files = declarations(process.env.MTG_CORRECTION_FILES_SOURCE || new URL("../lib/acquisition-correction-files.ts", import.meta.url),
  ["ownerDirectory", "temporaryDirectory", "syncDirectory", "readCorrectionBlob", "prepareCorrectionBlob"],
  ["verifyCorrectionBlobDurability"]);
const worker = declarations(process.env.MTG_CORRECTION_WORKER_SOURCE || new URL("../lib/acquisition-correction-worker.ts", import.meta.url),
  ["correctionMaintenanceGate", "completeCorrectionCapture", "failCorrectionCapture", "runCorrectionCaptureOnce"]);
const digestOf = bytes => createHash("sha256").update(bytes).digest("hex");
const storageError = () => Object.assign(new Error("controlled directory sync refusal"), { code: "ENOSPC" });

// Real owned original/temporary files and actual production function bodies.
// The database adapter models transaction rollback and authority, not PostgreSQL
// concurrency. Windows models Linux directory handles; Linux uses real handles.
async function fixture(work) {
  const parent = path.resolve(".local-data");
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "correction-retry-"));
  const owner = "retry-owner", bytes = Buffer.from("preserved immutable scanner original"), digest = digestOf(bytes);
  const sourceFile = path.join(root, "source.original"), peer = path.join(root, "peer.original");
  const peerBytes = Buffer.from("protected unrelated original");
  await fsp.writeFile(sourceFile, bytes); await fsp.writeFile(peer, peerBytes);
  const directory = path.join(root, "correction-library-v1", digestOf(owner));
  const original = path.join(directory, digest + ".original");
  const now = new Date("2026-10-25T12:00:00Z");
  let state = {
    blob: { id: "blob", ownerPlayerId: owner, digest, bytes: bytes.length, state: "PENDING", reserved: true, preservedAt: null },
    account: { ownerPlayerId: owner, limitBytes: 100000n, reservedBytes: BigInt(bytes.length), preservedBytes: 0n, evidenceBytes: 0n },
    outbox: { id: "outbox", status: "PENDING", leaseToken: null, leaseExpiresAt: null, errorCode: null },
    pin: { photoId: "source-photo", releasedAt: null },
  };
  const controls = { refuseSync: true, backup: false, authority: true, sourceReads: 0, syncs: 0, closes: 0, publications: 0 };
  const tx = {
    $executeRaw: async strings => { assert.match(strings.join("?"), /pg_advisory_xact_lock/); return 1; },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes("SELECT o.id")) {
        assert.deepEqual(values, [state.outbox.id, state.outbox.leaseToken]);
        return controls.authority && state.outbox.status === "RUNNING" && state.blob.state === "PENDING" ? [{ id: "outbox" }] : [];
      }
      assert.match(sql, /clock_timestamp\(\) AS now/); return [{ now }];
    },
    correctionLibraryAccount: {
      findUniqueOrThrow: async ({ where }) => { assert.equal(where.ownerPlayerId, owner); return structuredClone(state.account); },
      update: async ({ where, data }) => {
        assert.equal(where.ownerPlayerId, owner);
        state.account.reservedBytes -= BigInt(data.reservedBytes.decrement);
        state.account.preservedBytes += BigInt(data.preservedBytes.increment);
      },
    },
    correctionBlob: { update: async ({ where, data }) => { assert.equal(where.id, "blob"); Object.assign(state.blob, data); } },
    correctionCaptureOutbox: { update: async ({ where, data }) => { assert.equal(where.id, "outbox"); Object.assign(state.outbox, data); } },
    correctionRetentionPin: {
      findMany: async () => state.pin.releasedAt ? [] : [{ ...state.pin }],
      updateMany: async ({ where, data }) => { assert.equal(where.blobId, "blob"); state.pin.releasedAt = data.releasedAt; return { count: 1 }; },
    },
  };
  const db = {
    correctionRetentionPin: tx.correctionRetentionPin,
    $transaction: async callback => {
      const before = structuredClone(state);
      try { return await callback(tx); } catch (error) { state = before; throw error; }
    },
    $executeRaw: async (strings, code, id, token) => {
      assert.match(strings.join("?"), /SET status='PENDING'/);
      assert.equal(id, "outbox"); assert.equal(token, state.outbox.leaseToken);
      state.outbox.status = "PENDING"; state.outbox.errorCode = code;
      state.outbox.leaseToken = null; state.outbox.leaseExpiresAt = null;
      return 1;
    },
  };
  const context = {
    Buffer, Date, Object, AggregateError, Error, constants, createHash, randomUUID, path, z,
    process: { platform: "linux", env: { UPLOADS_DATA_PATH: root } },
    CORRECTION_LIBRARY_DIRECTORY: "correction-library-v1", PHOTO_MAX_BYTES: 10 * 1024 * 1024,
    digestSchema: z.string().regex(/^[a-f0-9]{64}$/), photoDigest: digestOf,
    mkdir: fsp.mkdir, realpath: fsp.realpath, lstat: fsp.lstat, unlink: fsp.unlink,
    link: async (...args) => { await fsp.link(...args); controls.publications++; },
    open: async (target, flags, mode) => {
      if (flags !== "r") return fsp.open(target, flags, mode);
      assert.equal(target, directory);
      const handle = process.platform === "win32" ? null : await fsp.open(target, flags);
      return {
        sync: async () => { controls.syncs++; if (controls.refuseSync) throw storageError(); await handle?.sync(); },
        close: async () => { await handle?.close(); controls.closes++; },
      };
    },
    lockCorrectionOwner: async (_tx, actual) => assert.equal(actual, owner),
    correctionBackupActive: async () => controls.backup,
    claimCorrectionCapture: async () => {
      if (state.outbox.status !== "PENDING" || state.blob.state !== "PENDING") return null;
      Object.assign(state.outbox, { status: "RUNNING", leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + 120000) });
      return { ...structuredClone(state.outbox), blob: structuredClone(state.blob) };
    },
    readAcquisitionPhotoBytes: async (id, variant, expected) => {
      assert.equal(id, "source-photo"); assert.equal(variant, "raw"); assert.equal(expected, digest);
      controls.sourceReads++; return fsp.readFile(sourceFile);
    },
  };
  const run = vm.runInNewContext(files + "\n" + worker + "\nrunCorrectionCaptureOnce", context);
  const preserved = async () => {
    assert.deepEqual(await fsp.readFile(sourceFile), bytes);
    assert.deepEqual(await fsp.readFile(peer), peerBytes);
    if (fs.existsSync(original)) assert.deepEqual(await fsp.readFile(original), bytes);
  };
  try {
    await work({ run: () => run(db), controls, state: () => state, original, bytes, preserved });
    await preserved();
    if (fs.existsSync(path.join(directory, "temporary"))) assert.deepEqual(await fsp.readdir(path.join(directory, "temporary")), []);
  } finally {
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith("correction-retry-"));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function assertPending(f) {
  assert.equal(f.state().blob.state, "PENDING");
  assert.equal(f.state().outbox.status, "PENDING");
  assert.equal(f.state().outbox.errorCode, "ENOSPC");
  assert.equal(f.state().pin.releasedAt, null);
  assert.equal(f.state().account.preservedBytes, 0n);
  assert.equal(f.state().account.reservedBytes, BigInt(f.bytes.length));
}

test("failed correction publication keeps bytes and source pin; persistent retry repeats durability", () => fixture(async f => {
  assert.equal((await f.run()).failed, 1); assertPending(f);
  assert.equal(f.controls.publications, 1); assert.equal(f.controls.syncs, 1); await f.preserved();
  assert.equal((await f.run()).failed, 1); assertPending(f);
  assert.equal(f.controls.syncs, 2); assert.equal(f.controls.closes, 2);
  assert.equal(f.controls.sourceReads, 1); assert.equal(f.controls.publications, 1);
}));

test("existing correction retry syncs before one preservation/accounting/pin release and replay is empty", () => fixture(async f => {
  await f.run(); assertPending(f);
  f.controls.refuseSync = false;
  assert.equal((await f.run()).preserved, 1);
  assert.equal(f.controls.syncs, 2); assert.equal(f.controls.closes, 2);
  assert.equal(f.state().blob.state, "PRESERVED"); assert.equal(f.state().outbox.status, "COMPLETE");
  assert.equal(f.state().account.reservedBytes, 0n); assert.equal(f.state().account.preservedBytes, BigInt(f.bytes.length));
  assert.ok(f.state().pin.releasedAt);
  const before = structuredClone(f.state());
  assert.equal((await f.run()).claimed, 0); assert.deepEqual(f.state(), before);
  assert.equal(f.controls.syncs, 2); assert.equal(f.controls.sourceReads, 1); assert.equal(f.controls.publications, 1);
}));

test("a backup still retains source pins after durable existing-file recovery", () => fixture(async f => {
  await f.run(); assertPending(f); f.controls.refuseSync = false; f.controls.backup = true;
  assert.equal((await f.run()).preserved, 1);
  assert.equal(f.controls.syncs, 2); assert.equal(f.state().pin.releasedAt, null);
  assert.equal(f.state().account.preservedBytes, BigInt(f.bytes.length));
}));

test("lost completion authority cannot sync or attach an existing original", () => fixture(async f => {
  await f.run(); assertPending(f); f.controls.refuseSync = false; f.controls.authority = false;
  assert.equal((await f.run()).preserved, 0);
  assert.equal(f.controls.syncs, 1); assert.equal(f.state().blob.state, "PENDING");
  assert.equal(f.state().pin.releasedAt, null); assert.equal(f.state().account.preservedBytes, 0n);
}));

test("ordinary correction publication syncs once before preservation", () => fixture(async f => {
  f.controls.refuseSync = false;
  assert.equal((await f.run()).preserved, 1);
  assert.equal(f.controls.syncs, 1); assert.equal(f.controls.closes, 1); assert.equal(f.controls.publications, 1);
  assert.equal(f.state().blob.state, "PRESERVED"); assert.ok(f.state().pin.releasedAt);
}));
