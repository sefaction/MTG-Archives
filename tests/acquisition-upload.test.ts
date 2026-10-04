import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { acquisitionError } from "../lib/acquisition-api";
import {
  isRetryableAcquisitionConflict,
  uploadAcquisitionPhoto,
  reserveAcquisitionPhotoSlot,
  acquisitionConflictBackoff,
  acquisitionUploadFailureDiagnostic,
} from "../lib/acquisition-upload";

const url = "/api/acquisition/session/photos?slot=s&key=k&generation=0&inputKind=CARD_SCAN";
const blob = new Blob(["retained original"], { type: "image/jpeg" });
const ready = () => Response.json({ ready: true });
const wait = async () => {};

test("database retry jitter stays within the pre-existing finite backoff budget", () => {
  const caps=[15,30,60,120,240];
  for(const [attempt,cap] of caps.entries()){
    const early=acquisitionConflictBackoff(attempt,()=>0);
    const late=acquisitionConflictBackoff(attempt,()=>1);
    assert.ok(early>0 && early<late);
    assert.equal(late,cap);
    assert.ok(Number.isInteger(early));
  }
  assert.equal(caps.reduce((sum,n)=>sum+n,0),465);
});

test("upload stage diagnostics retain only fixed classification and safe database codes", () => {
  const error={code:"P2010",message:"password and private card path",meta:{code:"40001",query:"secret SQL"}};
  assert.deepEqual(acquisitionUploadFailureDiagnostic(error,"FINALIZE"),{
    event:"ACQUISITION_UPLOAD_FAILURE",phase:"FINALIZE",code:"P2010",sqlState:"40001",retryable:true,
  });
  const rejected=acquisitionUploadFailureDiagnostic({code:"credential",meta:{code:"private path"}},"WRITE");
  assert.deepEqual(rejected,{event:"ACQUISITION_UPLOAD_FAILURE",phase:"WRITE",code:"UNCLASSIFIED",retryable:false});
  assert.equal(JSON.stringify(rejected).includes('private'),false);
});

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

test("connection lost while reading an acknowledgement retries without trusting partial bytes", async () => {
  let calls = 0;
  await uploadAcquisitionPhoto(url, blob, {
    signal: new AbortController().signal, wait,
    request: async () => {
      calls++;
      if(calls>1) return ready();
      return new Response(new ReadableStream({
        start(controller) { controller.error(new TypeError("body connection lost")); },
      }));
    },
  });
  assert.equal(calls, 2);
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

test("slot reservation reuses its one request key after a conflict or lost acknowledgement", async () => {
  const calls: RequestInit[] = [];
  const result = await reserveAcquisitionPhotoSlot<{slot:{id:string,generation:number}}>(
    "/api/acquisition/session", "a7251f4d-5bfb-45b3-85e5-312023964733", {
      signal: new AbortController().signal, wait,
      request: async (_url, options) => {
        calls.push(options!);
        if(calls.length===1) return Response.json({retryable:true}, {status:409});
        if(calls.length===2) throw new TypeError("lost ACK");
        return Response.json({slot:{id:"reserved-slot",generation:0}});
      },
    });
  assert.equal(result.slot.id, "reserved-slot");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c=>c.body===calls[0].body&&c.method==="POST"));
  assert.deepEqual(JSON.parse(String(calls[0].body)), {
    action:"reserve",requestKey:"a7251f4d-5bfb-45b3-85e5-312023964733",
  });
});
