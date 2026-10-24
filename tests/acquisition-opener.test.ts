import assert from "node:assert/strict";
import test from "node:test";
import {acquisitionDefaultsSchema, acquisitionReviewDecisionSchema, acquisitionReviewOpener,
  preserveAcquisitionReviewOpener} from "../lib/acquisition-review";

const defaults = {finish: "NONFOIL" as const, condition: "NM" as const};
const decision = {cardId: "printing", language: "en", finish: "NONFOIL" as const, condition: "NM" as const};

test("legacy defaults and reviews retain their exact representation and Unknown opener", () => {
  assert.deepEqual(acquisitionDefaultsSchema.parse(defaults), defaults);
  assert.deepEqual(acquisitionReviewDecisionSchema.parse(decision), decision);
  assert.equal(acquisitionReviewOpener(defaults, null), null);
  assert.equal(acquisitionReviewOpener({...defaults, openerPlayerId: "new-default"}, {}), null);
});

test("only unreviewed cards receive the batch opener; saved known and Unknown choices survive", () => {
  const batch = {...defaults, openerPlayerId: "chosen-person"};
  assert.equal(acquisitionReviewOpener(batch, null), "chosen-person");
  assert.equal(acquisitionReviewOpener(batch, {openerPlayerId: "previous-person"}), "previous-person");
  assert.equal(acquisitionReviewOpener(batch, {openerPlayerId: null}), null);
  assert.equal(acquisitionReviewOpener({...batch, openerPlayerId: null}, {openerPlayerId: "previous-person"}), "previous-person");
});

test("older clients preserve saved provenance while explicit per-card overrides remain authoritative", () => {
  const saved = {openerPlayerId: "saved-person"};
  assert.deepEqual(preserveAcquisitionReviewOpener(decision, saved), {...decision, ...saved});
  assert.deepEqual(preserveAcquisitionReviewOpener({...decision, openerPlayerId: null}, saved), {...decision, openerPlayerId: null});
  assert.deepEqual(preserveAcquisitionReviewOpener({...decision, openerPlayerId: "other-person"}, saved), {...decision, openerPlayerId: "other-person"});
  assert.deepEqual(preserveAcquisitionReviewOpener(decision, null), decision);
  assert.deepEqual(preserveAcquisitionReviewOpener(decision, {}), decision);
});

test("opener defaults and per-card choices accept explicit Unknown or a bounded identity", () => {
  for (const openerPlayerId of [null, "chosen-person"]) {
    assert.equal(acquisitionDefaultsSchema.parse({...defaults, openerPlayerId}).openerPlayerId, openerPlayerId);
    assert.equal(acquisitionReviewDecisionSchema.parse({...decision, openerPlayerId}).openerPlayerId, openerPlayerId);
  }
  for (const openerPlayerId of ["", "x".repeat(201), false, {id: "person"}]) {
    assert.equal(acquisitionDefaultsSchema.safeParse({...defaults, openerPlayerId}).success, false);
    assert.equal(acquisitionReviewDecisionSchema.safeParse({...decision, openerPlayerId}).success, false);
  }
  assert.equal(acquisitionReviewDecisionSchema.safeParse({...decision, actorId: "forged"}).success, false);
});
