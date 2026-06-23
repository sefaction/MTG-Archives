import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("admin mode toggle preserves current page and scroll state", () => {
  const toggle = readFileSync("components/AdminModeToggle.tsx", "utf8");
  const nav = readFileSync("components/Nav.tsx", "utf8");

  assert.match(toggle, /usePathname/);
  assert.match(toggle, /useSearchParams/);
  assert.match(toggle, /name="returnTo"/);
  assert.match(toggle, /window\.sessionStorage\.setItem/);
  assert.match(toggle, /window\.scrollTo\(0, scrollY\)/);

  assert.match(nav, /getSafeReturnTo/);
  assert.match(nav, /returnTo\.startsWith\("\/"\)/);
  assert.match(nav, /returnTo\.startsWith\("\/\/"\)/);
  assert.match(nav, /redirect\(getSafeReturnTo\(formData\)\)/);
  assert.doesNotMatch(nav, /await setAdminMode\(true\);\s*redirect\("\/dashboard"\)/);
  assert.doesNotMatch(nav, /await setAdminMode\(false\);\s*redirect\("\/dashboard"\)/);
});
