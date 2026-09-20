import assert from "node:assert/strict";
import test from "node:test";
import { vaultSectionHref } from "../lib/vault-navigation";
import {
  parseInventoryFilters,
  buildInventoryWhereFromFilters,
  removeInventoryFilterParams,
} from "../lib/inventory-filters";

test("vault section navigation resets paging and conflicting location aliases but retains search", () => {
  const url = new URL(
    vaultSectionHref(
      "vault",
      "Sect 1",
      "locationId=old&location=other&hasLocation=unassigned&page=7&cardName=Forest&sort=name",
    ),
    "http://local",
  );
  assert.equal(url.pathname, "/inventory");
  assert.deepEqual(url.searchParams.getAll("locationId"), ["vault"]);
  for (const key of ["location", "hasLocation", "page"])
    assert.equal(url.searchParams.has(key), false);
  assert.equal(url.searchParams.get("cardName"), "Forest");
  assert.equal(url.searchParams.get("sort"), "name");
  assert.equal(url.searchParams.get("locationSection"), "Sect 1");
  assert.equal(url.searchParams.get("locationSectionMatch"), "exact");
});

test("unsectioned and whole-vault links are distinct and arbitrary names round-trip", () => {
  const empty = new URL(vaultSectionHref("vault", ""), "http://local");
  assert.equal(empty.searchParams.get("locationSectionMatch"), "empty");
  const all = new URL(
    vaultSectionHref("vault", null, empty.search),
    "http://local",
  );
  assert.equal(all.searchParams.has("locationSectionMatch"), false);
  assert.equal(all.searchParams.has("locationSection"), false);
  const label = "Extra / A & B";
  assert.equal(
    new URL(vaultSectionHref("vault", label), "http://local").searchParams.get(
      "locationSection",
    ),
    label,
  );
});

test("exact section filters cannot include similarly named sections and retain owner scope", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams(
      "locationId=vault&locationSection=Sect+1&locationSectionMatch=exact",
    ),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: false,
    playerId: "owner",
  });
  assert.deepEqual(where.locationSection, { equals: "Sect 1" });
  assert.equal(where.currentOwnerId, "owner");
  assert.deepEqual(where.AND[0], { OR: [{ locationId: { in: ["vault"] } }] });
});

test("unsectioned filtering adds null/empty alternatives without weakening existing scope", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams(
      "locationId=vault&locationSectionMatch=empty&locationSection=ignored",
    ),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: false,
    playerId: "owner",
  });
  assert.equal(where.currentOwnerId, "owner");
  assert.deepEqual(where.AND[0], { OR: [{ locationId: { in: ["vault"] } }] });
  assert.deepEqual(where.AND[1], {
    OR: [{ locationSection: null }, { locationSection: "" }],
  });
  assert.equal(where.locationSection, undefined);
});

test("clearing inventory filters removes section modes and unknown modes retain contains semantics", () => {
  const params = new URLSearchParams(
    "locationSectionMatch=exact&locationSection=Sect+1&displayMode=exact",
  );
  const cleared = removeInventoryFilterParams(params);
  assert.equal(cleared.has("locationSectionMatch"), false);
  assert.equal(cleared.has("locationSection"), false);
  const filters = parseInventoryFilters(
    new URLSearchParams("locationSectionMatch=unknown&locationSection=Sect+1"),
  );
  assert.deepEqual(
    buildInventoryWhereFromFilters(filters, { adminModeActive: true })
      .locationSection,
    { contains: "Sect 1", mode: "insensitive" },
  );
});
