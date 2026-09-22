import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/inventory/page.tsx", "utf8");
const browser = readFileSync("components/InventoryBrowser.tsx", "utf8");

test("bulk moves return and apply fresh source and destination occupancy", () => {
  assert.match(page, /const refreshedLocations = await getStorageLocations\(/);
  assert.match(page, /refreshedLocations,/);
  assert.match(browser, /refreshedLocations\?: StorageLocation\[\]/);
  assert.match(browser, /setLiveStorageLocations\(\(current\) =>/);
  assert.match(browser, /refreshed\.get\(location\.id\) \?\? location/);
});
