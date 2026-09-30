import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { scannerConnectionError } from "../lib/scanner-errors";
import { readScannerJson } from "../lib/scanner-http";
import { claimScannerPairing, listScannerAgents } from "../lib/scanner-store";

test("database outage remains retryable and does not leak database details", async () => {
  const db = { $transaction: async () => { throw new Error("private database host/token"); } } as unknown as PrismaClient;
  let failure: unknown;
  try { await listScannerAgents(db, "owner"); } catch (error) { failure = error; }
  const response = scannerConnectionError(failure);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(await response.text(), /private database host\/token/);
});

test("known inactive owner is an actual permanent connection rejection", async () => {
  const db = { $transaction: async (work: (tx: unknown) => unknown) =>
    work({ user: { findUnique: async () => null } }) } as unknown as PrismaClient;
  let failure: unknown;
  try { await listScannerAgents(db, "inactive"); } catch (error) { failure = error; }
  assert.equal(scannerConnectionError(failure).status, 403);
});

test("invalid pairing protocol is a request error before any database operation", async () => {
  const db = {} as PrismaClient;
  let failure: unknown;
  try { await claimScannerPairing(db, { version: 9 }); } catch (error) { failure = error; }
  assert.equal(scannerConnectionError(failure).status, 400);
});

for (const [name, body, limit, status] of [
  ["malformed JSON", "{", 4096, 400],
  ["oversized input", "12345", 4, 413],
  ["malformed UTF8", new Uint8Array([0xff]), 4096, 400],
] as const) test(`${name} is not confused with revoked credentials`, async () => {
  let failure: unknown;
  try { await readScannerJson(new Request("https://fixture.invalid/", { method: "POST", body }), limit); }
  catch (error) { failure = error; }
  assert.equal(scannerConnectionError(failure).status, status);
});
