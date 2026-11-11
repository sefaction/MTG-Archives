import assert from "node:assert/strict";
import { test } from "node:test";
import {
  publicInventoryLink,
  publicInventoryOwnerLink,
  publicInventoryUsername,
} from "../lib/public-inventory-link";

test("public inventory links use existing usernames and escape URL path syntax", () => {
  assert.equal(publicInventoryLink("brian"), "/public/inventory/brian");
  for (const username of [".", "..", "~brian", "A/B #1", "Éowyn", "%2F"]) {
    const url = new URL(publicInventoryLink(username), "https://example.test");
    const segment = url.pathname.split("/").at(-1)!;
    assert.equal(publicInventoryUsername(decodeURIComponent(segment)), username);
  }
});

test("the resolved member replaces every supplied owner filter", () => {
  const filters = new URLSearchParams([
    ["owner", "other-player"],
    ["owner", "third-player"],
    ["ownerId", "other-player"],
    ["cardName", "Lightning Bolt"],
    ["language", "EN"],
    ["language", "FR"],
  ]);
  const url = new URL(
    publicInventoryOwnerLink("member-player", filters),
    "https://example.test",
  );
  assert.equal(url.pathname, "/public/inventory");
  assert.deepEqual(url.searchParams.getAll("owner"), ["member-player"]);
  assert.equal(url.searchParams.has("ownerId"), false);
  assert.equal(url.searchParams.get("cardName"), "Lightning Bolt");
  assert.deepEqual(url.searchParams.getAll("language"), ["EN", "FR"]);
});
