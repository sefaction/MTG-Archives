import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetScryfallClientForTests,
  getCardByScryfallIdResult,
  getCardBySetAndCollectorResult,
  searchCardsResult,
} from "../lib/scryfall";
import { normalizeCollectorNumber } from "../lib/card-import";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const sampleCard = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Sol Ring",
  cmc: 1,
  color_identity: [],
  type_line: "Artifact",
  set: "cmm",
  set_name: "Commander Masters",
  collector_number: "001",
  rarity: "uncommon",
};

test("Scryfall client sends configured headers and base URL", async () => {
  __resetScryfallClientForTests();
  process.env.SCRYFALL_API_BASE_URL = "https://scryfall.test";
  process.env.SCRYFALL_USER_AGENT = "MTG-Archives-Test/1.0";
  process.env.SCRYFALL_MIN_REQUEST_INTERVAL_MS = "0";
  process.env.SCRYFALL_MAX_RETRIES = "0";

  let seenUrl = "";
  let seenUserAgent = "";
  let seenAccept = "";
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    seenUserAgent = String(new Headers(init?.headers).get("User-Agent"));
    seenAccept = String(new Headers(init?.headers).get("Accept"));
    return jsonResponse(sampleCard);
  }) as typeof fetch;

  const result = await getCardByScryfallIdResult(sampleCard.id);
  assert.equal(result.ok, true);
  assert.equal(seenUrl, `https://scryfall.test/cards/${sampleCard.id}`);
  assert.equal(seenUserAgent, "MTG-Archives-Test/1.0");
  assert.match(seenAccept, /application\/json/);
});

test("Scryfall client honors Retry-After for rate limits", async () => {
  __resetScryfallClientForTests();
  process.env.SCRYFALL_API_BASE_URL = "https://scryfall.test";
  process.env.SCRYFALL_MIN_REQUEST_INTERVAL_MS = "0";
  process.env.SCRYFALL_MAX_RETRIES = "1";

  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse({ object: "error", details: "slow down" }, 429, {
        "Retry-After": "0",
      });
    }
    return jsonResponse(sampleCard);
  }) as typeof fetch;

  const result = await getCardByScryfallIdResult(sampleCard.id);
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("Scryfall client does not retry permanent not-found responses", async () => {
  __resetScryfallClientForTests();
  process.env.SCRYFALL_API_BASE_URL = "https://scryfall.test";
  process.env.SCRYFALL_MIN_REQUEST_INTERVAL_MS = "0";
  process.env.SCRYFALL_MAX_RETRIES = "4";

  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    return jsonResponse({ object: "error", details: "not found" }, 404);
  }) as typeof fetch;

  const result = await searchCardsResult("notarealcard");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "NOT_FOUND");
  assert.equal(attempts, 1);
});

test("Scryfall client retries transient upstream failures", async () => {
  __resetScryfallClientForTests();
  process.env.SCRYFALL_API_BASE_URL = "https://scryfall.test";
  process.env.SCRYFALL_MIN_REQUEST_INTERVAL_MS = "0";
  process.env.SCRYFALL_MAX_RETRIES = "2";

  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    return attempts === 1
      ? jsonResponse({ object: "error", details: "temporary" }, 503)
      : jsonResponse(sampleCard);
  }) as typeof fetch;

  const result = await getCardBySetAndCollectorResult("CMM", "001");
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("collector numbers are preserved as strings", () => {
  assert.equal(normalizeCollectorNumber("001"), "001");
  assert.equal(normalizeCollectorNumber("123a"), "123a");
  assert.equal(normalizeCollectorNumber("42★"), "42★");
});
