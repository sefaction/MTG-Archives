import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicNav = readFileSync("components/PublicNav.tsx", "utf8");
const publicHome = readFileSync("app/public/page.tsx", "utf8");
const publicInventory = readFileSync("app/public/inventory/page.tsx", "utf8");
const publicDecks = readFileSync("app/public/decks/page.tsx", "utf8");

test("public navigation uses the authenticated app nav for signed-in viewers", () => {
  assert.match(publicNav, /getCurrentUser\(\)/);
  assert.match(publicNav, /user \? \(/);
  assert.match(publicNav, /<Nav \/>/);
  assert.match(publicNav, /aria-label="Public browsing"/);
});

test("anonymous public navigation keeps public destinations and login", () => {
  assert.match(publicNav, /href="\/public"/);
  assert.match(publicNav, /href="\/public\/inventory"/);
  assert.match(publicNav, /href="\/public\/decks"/);
  assert.match(publicNav, /href="\/login"/);
});

test("all public index surfaces share authentication-aware navigation", () => {
  for (const source of [publicHome, publicInventory, publicDecks]) {
    assert.match(source, /import \{ PublicNav \}/);
    assert.match(source, /<PublicNav \/>/);
  }
});
