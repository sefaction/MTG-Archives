import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNavigationLayout } from "../lib/navigation-layout";

test("navigation layout accepts topbar and defaults safely to sidebar", () => {
  assert.equal(normalizeNavigationLayout("topbar"), "topbar");
  for (const value of ["sidebar", undefined, null, "", "TOPBAR", {}, 1]) {
    assert.equal(normalizeNavigationLayout(value), "sidebar");
  }
});
