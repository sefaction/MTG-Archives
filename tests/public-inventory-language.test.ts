import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicInventoryWhere } from "../lib/public-collection";
import { suggestionScopeSearchParams } from "../lib/inventory-filter-suggestions";

for (const [language, expected] of [
  ["FR", ["FR"]],
  [" en ", ["EN"]],
  ["en, FR, en", ["EN", "FR"]],
  ["unknown", ["UNKNOWN"]],
] as const) {
  test(`public language ${JSON.stringify(language)} constrains physical inventory`, () => {
    const where = buildPublicInventoryWhere({ language });
    assert.deepEqual(where.language, { in: [...expected] });
    // Adding a language must not replace visibility, owner or other predicates.
    const scoped = { owner: "public-owner", locationId: "public-box", finish: "foil", cardName: "Sentinel" };
    const filtered = buildPublicInventoryWhere({ ...scoped, language });
    const { language: constraint, ...rest } = filtered;
    assert.deepEqual(constraint, { in: [...expected] });
    assert.deepEqual(rest, buildPublicInventoryWhere(scoped));
  });
}

test("absent and empty language keep all otherwise eligible public inventory", () => {
  const baseline = buildPublicInventoryWhere({});
  assert.equal(baseline.language, undefined);
  for (const language of ["", "  ,  "]) {
    assert.deepEqual(buildPublicInventoryWhere({ language }), baseline);
  }
});

test("repeated page language values share the existing comma-list normalization", () => {
  assert.deepEqual(buildPublicInventoryWhere({ language: [" en,fr ", "EN"] }).language,
    { in: ["EN", "FR"] });
});

test("public suggestion scope retains the language predicate without importing its search text", () => {
  const scoped = suggestionScopeSearchParams(new URLSearchParams({
    kind: "cardName", q: "Suggestion", language: "fr,en", owner: "public-owner", public: "1",
  }));
  assert.equal(scoped.has("q"), false);
  const where = buildPublicInventoryWhere(Object.fromEntries(scoped));
  assert.deepEqual(where.language, { in: ["FR", "EN"] });
  const { language, ...withoutLanguage } = where;
  assert.deepEqual(withoutLanguage, buildPublicInventoryWhere({ owner: "public-owner" }));
});
