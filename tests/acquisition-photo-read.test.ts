import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { isAdminUser } from "../lib/auth-policy";
import { requireVisibleAcquisitionBatch } from "../lib/acquisition-batch-policy";

// Exercise the actual store functions without loading unrelated native adapters.
const filename = process.env.MTG_PHOTO_READ_SOURCE ?? "lib/acquisition-store.ts";
const parsed = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
const functions = ["authorize", "read", "getAcquisitionPhoto"].map(name => {
  const declaration = parsed.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.ok(declaration, `actual ${name} function required`);
  return declaration.getText(parsed);
});
const include = parsed.statements.find(s => ts.isVariableStatement(s) &&
  s.declarationList.declarations.some(d => d.name.getText(parsed) === "include"));
assert.ok(include, "actual relation projection required");
const compiled = ts.transpileModule(include.getText(parsed) + "\n" + functions.join("\n") + "\nexports.getPhoto=getAcquisitionPhoto;exports.read=read;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: { getPhoto?: (...args: any[]) => Promise<any>; read?: (...args: any[]) => Promise<any> } = {};
new Script(compiled).runInNewContext({
  exports, isAdminUser, requireVisibleAcquisitionBatch,
  identity: z.string().min(1).max(200).refine(s => s.trim() === s),
  transaction: (db: any, work: (tx: any) => unknown) => work(db),
});
const getPhoto = exports.getPhoto!;

test("single-card review reads retain its complete source history without unrelated cards", async () => {
  const f = fixture(); let query: any;
  f.row.run.candidates = [{id: "candidate", observations: [{artifactId: "older"}, {artifactId: "current"}]}];
  f.row.run.artifacts = []; f.row.run.corrections = [];
  (f.db as any).acquisitionArtifact = {findMany: async (args: any) => {
    assert.equal(args.where.runId, "run");
    assert.deepEqual(JSON.parse(JSON.stringify(args.where.OR)), [{id: {in: ["older", "current"]}}, {sourceId: "photo"}]);
    return [{id: "older"}, {id: "current"}];
  }};
  (f.db as any).acquisitionCountCorrection = {findMany: async (args: any) => {
    assert.deepEqual(JSON.parse(JSON.stringify(args.where)), {runId: "run", candidateId: {in: ["candidate"]}});
    return [{candidate: {physicalId: "slot"}}];
  }};
  f.db.acquisitionSession.findUnique = async (args: any) => { query = args; return f.row; };
  await exports.read!(f.db, f.actor, "batch", { photoId: "photo", slotId: "slot" });
  const scope = JSON.parse(JSON.stringify(query.include.run.include));
  assert.deepEqual(scope.candidates.where.physicalId.in, ["slot"]);
  assert.equal(scope.candidates.include.observations, true);
  assert.equal(scope.candidates.include.receipt, true);
  assert.equal(scope.artifacts.take, 0);
  assert.equal(scope.corrections.take, 0);
  assert.equal(f.row.run.artifacts.length, 2);
  assert.equal(f.row.run.corrections.length, 1);
});

function fixture() {
  const row: any = { ownerPlayerId: "owner", trashedAt: null, deletedAt: null, run: { id: "run" } };
  const user: any = { id: "user", username: "ordinary", role: "PLAYER", isActive: true,
    forcePasswordChange: false, playerId: "owner", player: { active: true, isAdmin: false } };
  const photo: any = { id: "photo", runId: "run", ready: true, purgedAt: null, digest: "immutable-digest", bytes: 2502853 };
  const calls: any[] = [];
  const db = {
    acquisitionSession: { findUnique: async (args: any) => {
      calls.push(args);
      assert.ok(args.select && !args.include, "photo reads must not load a full batch graph");
      return row;
    } },
    user: { findUnique: async () => user },
    acquisitionPhoto: { findUnique: async () => photo },
  };
  const actor = { userId: "user", adminMode: false };
  return { row, user, photo, calls, db, actor };
}

test("photo lookup returns unchanged metadata without loading unrelated batch records", async () => {
  const f = fixture();
  assert.equal(await getPhoto(f.db, f.actor, "batch", "photo"), f.photo);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].where.id, "batch");
  assert.deepEqual(Object.keys(f.calls[0].select).sort(), ["deletedAt", "ownerPlayerId", "run", "trashedAt"]);
});

test("photo lookup repeats live account authorization on every request", async () => {
  const f = fixture();
  await getPhoto(f.db, f.actor, "batch", "photo");
  f.user.isActive = false;
  await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Capture session unavailable/);
});

test("foreign owners, inactive owners and password-change accounts cannot read photos", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.user.playerId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.user.player.active = false; },
    (f: ReturnType<typeof fixture>) => { f.user.forcePasswordChange = true; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Capture session unavailable/);
  }
});

test("administrator cross-owner access still requires Admin Mode and a live account", async () => {
  const f = fixture(); f.user.playerId = "foreign"; f.user.role = "ADMIN";
  await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Capture session unavailable/);
  f.actor.adminMode = true;
  assert.equal(await getPhoto(f.db, f.actor, "batch", "photo"), f.photo);
  f.user.isActive = false;
  await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Capture session unavailable/);
});

test("trash and permanent deletion continue to hide private photos", async () => {
  for (const field of ["trashedAt", "deletedAt"]) {
    const f = fixture(); f.row[field] = new Date();
    await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Capture batch unavailable/);
  }
});

test("unready, purged, cross-run and orphaned photos remain unavailable", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.photo.ready = false; },
    (f: ReturnType<typeof fixture>) => { f.photo.purgedAt = new Date(); },
    (f: ReturnType<typeof fixture>) => { f.photo.runId = "another-run"; },
    (f: ReturnType<typeof fixture>) => { f.row.run = null; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(getPhoto(f.db, f.actor, "batch", "photo"), /Photo unavailable/);
  }
});

test("missing batches/photos and malformed identities fail without broadening access", async () => {
  const f = fixture();
  f.db.acquisitionSession.findUnique = async () => null;
  await assert.rejects(getPhoto(f.db, f.actor, "missing", "photo"), /Capture session unavailable/);
  const g = fixture(); g.db.acquisitionPhoto.findUnique = async () => null;
  await assert.rejects(getPhoto(g.db, g.actor, "batch", "missing"), /Photo unavailable/);
  await assert.rejects(getPhoto(g.db, g.actor, " batch ", "photo"));
  await assert.rejects(getPhoto(g.db, { userId: "", adminMode: true }, "batch", "photo"));
});
