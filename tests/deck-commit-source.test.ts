import assert from "node:assert/strict";
import test from "node:test";
import { deckCommitSourceLabel } from "../lib/deck-commit-source";

test("commit sources distinguish storage sections and all physical finishes", () => {
  const source = { locationName: "Vault", locationSection: "0" };
  assert.equal(
    deckCommitSourceLabel({ ...source, foilStatus: "NONFOIL" }),
    "Vault → Section 0 · Nonfoil",
  );
  assert.equal(
    deckCommitSourceLabel({ ...source, foilStatus: "FOIL" }),
    "Vault → Section 0 · Foil",
  );
  assert.equal(
    deckCommitSourceLabel({ ...source, locationSection: "1", foilStatus: "ETCHED" }),
    "Vault → Section 1 · Etched",
  );
});

test("unsectioned sources are explicit and stored section names remain readable", () => {
  for (const locationSection of [null, "", "  "]) {
    assert.equal(
      deckCommitSourceLabel({ locationName: "Unassigned", locationSection, foilStatus: "NONFOIL" }),
      "Unassigned → No section · Nonfoil",
    );
  }
  assert.equal(
    deckCommitSourceLabel({
      locationName: "Long storage location",
      locationSection: " Blue / rares ",
      foilStatus: "FOIL",
    }),
    "Long storage location → Section Blue / rares · Foil",
  );
});
