import assert from "node:assert/strict";
import test from "node:test";
import { inventorySortHref } from "../components/inventorySortNavigation";

test("sorting preserves repeated filters and view settings while returning to the first page", () => {
  const href = inventorySortHref("/public/inventory", "owner=a&owner=b&type=Equipment&locationType=League+2026&displayMode=grouped&browse=infinite&pageSize=25&page=4", "quantity", "desc");
  const url = new URL(href, "https://example.invalid");
  assert.equal(url.pathname, "/public/inventory");
  assert.deepEqual(url.searchParams.getAll("owner"), ["a", "b"]);
  for (const [key, value] of Object.entries({type:"Equipment", locationType:"League 2026",displayMode:"grouped",browse:"infinite",pageSize:"25",sort:"quantity",sortDir:"desc"}))
    assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has("page"), false);
});

test("clearing a sort preserves the active private inventory filters", () => {
  const url = new URL(inventorySortHref("/inventory", "cardName=Æther&type=Artifact&sort=quantity&sortDir=desc&page=3", "quantity", false), "https://example.invalid");
  assert.equal(url.searchParams.get("cardName"), "Æther");
  assert.equal(url.searchParams.get("type"), "Artifact");
  assert.equal(url.searchParams.has("sort"), false);
  assert.equal(url.searchParams.has("sortDir"), false);
  assert.equal(url.searchParams.has("page"), false);
  assert.throws(() => inventorySortHref("/inventory", "", "actions", "asc"), /Unsupported/);
});

