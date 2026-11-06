import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionPhotoLimits } from "../lib/acquisition-photo-limits";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import ts from "typescript";
import {z} from "zod";
import {acquisitionImageInputKindSchema} from "../lib/acquisition-image-input";
import { scannerRunError } from "../lib/scanner-errors";
import { scannerUploadMessage } from "../lib/scanner-preflight-message";
import { scannerPreflightReportSchema, scannerCanonical } from "../lib/scanner-run-protocol";
const GIB = 1024 ** 3;

test("existing cleanup watermarks remain finite and configurable", () => {
  assert.deepEqual(acquisitionPhotoLimits({}), { owner: 4 * GIB, batch: GIB });
  assert.deepEqual(acquisitionPhotoLimits({ ACQUISITION_PHOTO_OWNER_LIMIT_GIB: "64", ACQUISITION_PHOTO_BATCH_LIMIT_GIB: "4" }),
    { owner: 64 * GIB, batch: 4 * GIB });
  for (const value of ["0", "-1", "1.5", "Infinity", "NaN", "1e2", "1048577"])
    assert.throws(() => acquisitionPhotoLimits({ ACQUISITION_PHOTO_OWNER_LIMIT_GIB: value }));
});

test("actual photo admission and replay do not stop at retained-original allowances", async () => {
  const source = ts.createSourceFile("store.ts", readFileSync("lib/acquisition-store.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const begin = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "beginAcquisitionPhoto");
  const schema = source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(source) === "acquisitionPhotoMetadataSchema"));
  assert.ok(begin); assert.ok(schema);
  const row = {id: "batch", ownerPlayerId: "owner", phase: "CAPTURING", run: {id: "run", providerId: "phone-photo-v1", candidates: []}};
  const slot = {id: randomUUID(), runId: "run", generation: 0};
  let previous: any = null, inserts = 0;
  const tx = {acquisitionCaptureSlot: {findUnique: async () => slot, update: async () => {slot.generation++;}},
    acquisitionPhoto: {findUnique: async () => previous, count: async () => 0,
      aggregate: async () => {throw Error("Retained totals must not become an intake cap");},
      create: async ({data}: any) => {inserts++; return previous = {sourceMetadata: null, ...data, id: randomUUID(), ready: false};}}};
  const exports: any = {};
  new Script(ts.transpileModule(schema.getText(source) + "\n" + begin.getText(source), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText).runInNewContext({exports, z, scannerCanonical, acquisitionImageInputKindSchema, SCANNER_CAPTURE_PROVIDER: "scanner",
    lockedPhotoTransaction: (_db: unknown, _actor: unknown, _id: unknown, work: any) => work(tx),
    read: async () => row, destinationCurrent: () => true, selectCorrectionControl: async () => ({})});
  const input = {slotId: slot.id, uploadKey: randomUUID(), generation: 0,
    metadata: {bytes: 10 * 1024 ** 2, digest: "a".repeat(64), width: 100, height: 100, mediaType: "image/png"}};
  const first = await exports.beginAcquisitionPhoto(tx, {}, row.id, input);
  const replay = await exports.beginAcquisitionPhoto(tx, {}, row.id, input);
  assert.equal(first.id, replay.id); assert.equal(inserts, 1);
  await assert.rejects(exports.beginAcquisitionPhoto(tx, {}, row.id, {...input,
    metadata: {...input.metadata, digest: "b".repeat(64)}}), /identity conflict/);
});

test("actual storage exhaustion is recoverable and guidance rejects untrusted text", async () => {
  const response = scannerRunError(Object.assign(Error("private filesystem details"), {code: "ENOSPC"}));
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.code, "PHOTO_DISK_SPACE"); assert.doesNotMatch(data.error, /private filesystem/);
  const problem = { code: "PHOTO_DISK_SPACE", observedAt: new Date().toISOString() };
  assert.match(scannerUploadMessage(problem)!, /Uploads are waiting/);
  assert.match(scannerUploadMessage(problem)!, /without scanning the cards again/);
  assert.equal(scannerUploadMessage({ ...problem, privatePath: "secret" }), null);
  assert.equal(scannerUploadMessage({ ...problem, scope: "secret" }), null);
  assert.equal(scannerPreflightReportSchema.safeParse({ ...problem, version: 1 }).success, false);
});
