import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { acquisitionError } from "../lib/acquisition-api";
import {
  isRetryableAcquisitionConflict,
  uploadAcquisitionPhoto,
} from "../lib/acquisition-upload";

const url = "/api/acquisition/session/photos?slot=s&key=k&generation=0&inputKind=CARD_SCAN";
const blob = new Blob(["retained original"], { type: "image/jpeg" });
const ready = () => Response.json({ ready: true });
const wait = async () => {};

test("only known database serialization/deadlock errors carry a safe retry hint", async () => {
  for (const [code, meta] of [
    ["P2034", undefined],
    ["P2010", { code: "40001" }],
    ["P2010", { code: "40P01" }],
  ] as const) {
    const error = new Prisma.PrismaClientKnownRequestError("internal diagnostic", {
      code, meta, clientVersion: "fixture",
    });
    assert.equal(isRetryableAcquisitionConflict(error), true);
    const response = acquisitionError(error);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "The scan request could not be completed. Refresh and retry.",
      retryable: true,
    });
  }
  for (const error of [
    new Error("Photo upload identity conflict"),
    new Error("Destination changed; refresh"),
    new Error("Login required"),
    new Error("P2034"),
    { code: "P2002" },
    { code: "P2010", meta: { code: "23505" } },
    { code: "P2010" }, null, "40001",
  ]) {
    assert.equal(isRetryableAcquisitionConflict(error), false);
    assert.equal((await acquisitionError(error).json()).retryable, undefined);
  }
});

test("lost acknowledgement and marked conflict retry the exact identity and blob", async () => {
  const controller = new AbortController();
  const calls: { url: unknown; options?: RequestInit }[] = [];
  const retries: number[] = [], delays: number[] = [];
  await uploadAcquisitionPhoto(url, blob, {
    signal: controller.signal,
    onRetry: n => retries.push(n),
    random: () => 0.3,
    wait: async n => { delays.push(n); },
    request: async (address, options) => {
      calls.push({ url: address, options });
      if (calls.length === 1) throw new TypeError("Failed to fetch");
      if (calls.length === 2) return Response.json({ error: "busy", retryable: true }, { status: 409 });
      return ready();
    },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(retries, [1, 2]);
  assert.ok(delays[0] > 0 && delays[1] > delays[0] && delays[1] < 5000);
  for (const call of calls) {
    assert.equal(call.url, url);
    assert.equal(call.options?.body, blob);
    assert.equal(call.options?.signal, controller.signal);
    assert.equal(call.options?.method, "POST");
    assert.deepEqual(call.options?.headers, { "Content-Type": "image/jpeg" });
  }
});

test("domain/auth rejection, missing hint and invalid success never retry or acknowledge", async () => {
  for (const response of [
    Response.json({ error: "Photo upload identity conflict" }, { status: 409 }),
    Response.json({ error: "Login required", retryable: true }, { status: 403 }),
    Response.json({ error: "unclassified" }, { status: 500 }),
    Response.json({ ready: false }),
    Response.json({ ready: "true" }),
    new Response("unexpected HTML"),
  ]) {
    let calls = 0;
    await assert.rejects(uploadAcquisitionPhoto(url, blob, {
      signal: new AbortController().signal, wait,
      request: async () => { calls++; return response; },
    }));
    assert.equal(calls, 1);
  }
});

test("temporary gateway failure can recover; persistent failure is bounded", async () => {
  let calls = 0;
  await uploadAcquisitionPhoto(url, blob, {
    signal: new AbortController().signal, wait,
    request: async () => ++calls === 1 ? new Response("gateway", { status: 503 }) : ready(),
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(uploadAcquisitionPhoto(url, blob, {
    signal: new AbortController().signal, wait,
    request: async () => { calls++; return Response.json({ error: "busy", retryable: true }, { status: 409 }); },
  }), /busy/);
  assert.equal(calls, 3);
});

test("overall deadline cancels backoff and prevents another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = uploadAcquisitionPhoto(url, blob, {
    signal: controller.signal,
    onRetry: () => setTimeout(() => controller.abort(new Error("deadline")), 5),
    request: async () => { calls++; throw new TypeError("Failed to fetch"); },
  });
  await assert.rejects(promise, /deadline/);
  assert.equal(calls, 1);
});
