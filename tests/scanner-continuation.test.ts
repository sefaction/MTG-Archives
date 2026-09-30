import assert from "node:assert/strict";
import test from "node:test";
import { currentScannerContinuation, type ScannerContinuation } from "../lib/scanner-continuation";
import type { StorageLocation } from "../lib/storage-sections";

const previous: ScannerContinuation = { locationId: "box", section: "A", defaults: { finish: "NONFOIL", condition: "NM" },
  scanner: { agentId: "fixture", deviceId: "fixture", loadedCount: null, operatorLoadedSimplexFronts: true,
    settings: { dpi: 600, widthInches: 2.6, heightInches: 3.6, horizontalPlacement: "Start", duplex: false,
      color: "RGB", autoCrop: false, deskew: false, removeBlank: false } } };
const location: StorageLocation = { id: "box", name: "Current", sections: [{ name: "A", capacity: 72, quantity: 71 }] };

test("continuation is a preference against current locations, not a capacity snapshot", () => {
  assert.equal(currentScannerContinuation(previous, [location]).setup, previous);
  assert.equal(currentScannerContinuation(previous, []).setup, null);
  assert.equal("target" in previous, false);
});
test("removed section needs a new choice without losing scanner/default preferences", () => {
  const result = currentScannerContinuation(previous, [{ ...location, sections: [] }]);
  assert.equal(result.setup?.section, ""); assert.equal(result.setup?.scanner, previous.scanner);
  assert.equal(result.setup?.defaults, previous.defaults); assert.match(result.message, /section is unavailable/);
});
