import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userFacingFiles = [
  "components/InventoryBrowser.tsx",
  "app/inventory/page.tsx",
  "app/imports/page.tsx",
  "app/api/inventory/export/route.ts",
  "app/trades/page.tsx",
  "README.md",
];

const removedUserFacingLabels = [
  /Acquisition group/i,
  /Original opener/i,
  /Original owner/i,
  /No acquisition group/i,
  /Sealed Commander/i,
  /Box League/i,
];

test("normal inventory/import/export/trade surfaces do not expose legacy league labels", () => {
  for (const file of userFacingFiles) {
    const text = readFileSync(file, "utf8");
    for (const pattern of removedUserFacingLabels) {
      assert.equal(
        pattern.test(text),
        false,
        `${file} should not contain ${pattern}`,
      );
    }
  }
});
