import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetScryfallClientForTests,
  getAcquisitionCardResult,
  searchAcquisitionPrintingsPageResult,
} from "../lib/scryfall";

function setup() {
  __resetScryfallClientForTests();
  process.env.SCRYFALL_API_BASE_URL = "https://scryfall.test";
  process.env.SCRYFALL_MIN_REQUEST_INTERVAL_MS = "0";
  process.env.SCRYFALL_MAX_RETRIES = "2";
}

test("acquisition page query preserves literal names and asks for printings in the read language", async () => {
  setup();
  let seen: URL | undefined;
  global.fetch = (async (url: RequestInfo | URL) => {
    seen = new URL(String(url));
    return Response.json({ object: "list", data: [], has_more: false });
  }) as typeof fetch;
  await searchAcquisitionPrintingsPageResult('Card " or set:bad', 3, "fr");
  assert.equal(seen?.origin, "https://scryfall.test");
  assert.equal(seen?.pathname, "/cards/search");
  assert.equal(
    seen?.searchParams.get("q"),
    `!${JSON.stringify('Card " or set:bad')} game:paper lang:fr`,
  );
  assert.equal(seen?.searchParams.get("unique"), "prints");
  assert.equal(seen?.searchParams.get("page"), "3");
  assert.equal(seen?.searchParams.get("include_multilingual"), "true");
  assert.equal(seen?.searchParams.get("include_variations"), "true");
  assert.equal(seen?.searchParams.get("include_extras"), "true");
});

test("exact set/collector lookup sends language and retains composite List collector numbers", async () => {
  setup();
  let path = "";
  global.fetch = (async (url: RequestInfo | URL) => {
    path = new URL(String(url)).pathname;
    return Response.json({});
  }) as typeof fetch;
  await getAcquisitionCardResult({
    kind: "printing",
    set: "plst",
    number: "LGN-131",
    language: "en",
  });
  assert.equal(path, "/cards/plst/LGN-131/en");
});

test("cancelled acquisition request makes no call or automatic retry", async () => {
  setup();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return Response.json({});
  }) as typeof fetch;
  const result = await getAcquisitionCardResult(
    { kind: "name", name: "Krosan Vorine" },
    controller.signal,
  );
  assert.equal(calls, 0);
  assert.equal(result.requestsMade, 0);
  assert.equal(result.ok, false);
});

test("in-flight cancellation stops instead of consuming the client's retry budget", async () => {
  setup();
  const controller = new AbortController();
  let calls = 0;
  global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    queueMicrotask(() => controller.abort());
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;
  const result = await getAcquisitionCardResult(
    { kind: "name", name: "Krosan Vorine" },
    controller.signal,
  );
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.requestsMade, 1);
});

test("cancellation interrupts Retry-After backoff", async () => {
  setup();
  const controller = new AbortController();
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    setTimeout(() => controller.abort(), 10);
    return Response.json(
      { object: "error" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }) as typeof fetch;
  const started = Date.now();
  const result = await getAcquisitionCardResult(
    { kind: "name", name: "Krosan Vorine" },
    controller.signal,
  );
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 1000);
});
