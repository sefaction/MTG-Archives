import assert from "node:assert/strict";
import test from "node:test";
import { browseLocations, locationBrowseHref } from "../lib/location-browser";

const locations = [
  { id: "vault", name: "Vault", path: "Vault", type: "Vault" },
  {
    id: "box",
    name: "Box",
    path: "Vault / Box",
    parentLocationId: "vault",
    type: "Box",
  },
  {
    id: "sleeves",
    name: "Sleeves",
    path: "Vault / Box / Sleeves",
    parentLocationId: "box",
  },
  { id: "other", name: "Other", path: "Other" },
];

test("location search finds descendants by full path and preserves branch boundaries", () => {
  assert.deepEqual(
    browseLocations(locations, { q: "vault" }).items.map((x) => x.id),
    ["vault", "box", "sleeves"],
  );
  const branch = browseLocations(locations, { parent: "box" });
  assert.deepEqual(
    branch.items.map((x) => x.id),
    ["box", "sleeves"],
  );
  assert.deepEqual(
    branch.treeItems.map((x) => x.id),
    ["sleeves"],
  );
  assert.deepEqual(
    branch.breadcrumbs.map((x) => x.id),
    ["vault", "box"],
  );
  assert.equal(
    browseLocations(locations, { parent: "box", q: "other" }).total,
    0,
  );
});

test("unknown or inaccessible location ids cannot broaden the visible branch", () => {
  const result = browseLocations(locations, { parent: "private-other-owner" });
  assert.equal(result.total, 0);
  assert.equal(result.treeTotal, 0);
  assert.deepEqual(result.breadcrumbs, []);
});

test("thousands of locations render only bounded pages and tree levels", () => {
  const many = Array.from({ length: 3000 }, (_, i) => ({
    id: String(i),
    name: `Box ${i}`,
    path: `Box ${i}`,
  }));
  const first = browseLocations(many, {});
  assert.equal(first.total, 3000);
  assert.equal(first.pages, 120);
  assert.equal(first.items.length, 25);
  assert.equal(first.treeItems.length, 25);
  assert.equal(browseLocations(many, { page: "2" }).items[0].id, "25");
  assert.equal(
    browseLocations(many, { treePage: "120" }).treeItems[24].id,
    "2999",
  );
  for (const page of ["-1", "NaN", "Infinity", "2.5"])
    assert.equal(browseLocations(many, { page }).page, 1);
  assert.equal(browseLocations(many, { page: "999" }).page, 120);
});

test("broken hierarchy cycles cannot loop the browser traversal", () => {
  const cycle = [
    { id: "a", name: "A", path: "A", parentLocationId: "b" },
    { id: "b", name: "B", path: "B", parentLocationId: "a" },
  ];
  const result = browseLocations(cycle, { parent: "a" });
  assert.equal(result.total, 2);
  assert.equal(result.breadcrumbs.length, 2);
});

test("browse links encode search text, preserve context and clear the editor", () => {
  const href = locationBrowseHref(
    { q: "vault & box", parent: "v", edit: "x" },
    { page: "2", edit: undefined },
  );
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("q"), "vault & box");
  assert.equal(url.searchParams.get("parent"), "v");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.has("edit"), false);
  assert.equal(url.hash, "#normal-locations");
});
