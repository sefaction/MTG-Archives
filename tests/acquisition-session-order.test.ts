import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Script } from "node:vm";
import ts from "typescript";
import { acquisitionDefaultsSchema, emptyAcquisitionDefaults } from "../lib/acquisition-review";
import { candidateKey, captureSummary } from "../lib/acquisition-domain";

// Execute the actual private projection functions, not a rewritten serializer.
// The optional source override qualifies the pinned original failure separately.
const filename = process.env.MTG_ACQUISITION_HYDRATE_SOURCE ?? path.resolve("lib/acquisition-store.ts");
const source = readFileSync(filename, "utf8");
const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const functions = ["layoutRevision", "destinationCurrent", "hydrate"].map(name => {
  const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `actual ${name} declaration required`);
  return declaration.getText(parsed);
});
const compiled = ts.transpileModule(functions.join("\n") + "\nexports.hydrate=hydrate;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: { hydrate?: (row: any) => any } = {};
new Script(compiled).runInNewContext({ exports, createHash, acquisitionDefaultsSchema, emptyAcquisitionDefaults, candidateKey });
assert.ok(exports.hydrate);
const hydrate = (row: any) => JSON.parse(JSON.stringify(exports.hydrate!(row)));

function fixture() {
  const inputs = [
    { physicalId: "p-z", acquisitionOrder: 2, spatialOrder: 0 },
    { physicalId: "p-b", acquisitionOrder: 0, spatialOrder: 1 },
    { physicalId: "p-c", acquisitionOrder: 0, spatialOrder: 0 },
    { physicalId: "p-a", acquisitionOrder: 0, spatialOrder: 0 },
  ];
  return { version: 1, intent: "ADD_NEW", id: "session", phase: "COMPLETE", placement: {},
    policy: { kind: "MANUAL", quantity: 3 }, target: 3, ownerPlayerId: "owner", location: null,
    reviewDefaults: { condition: "NM", finish: "NONFOIL" }, defaultsRevision: 2, batchNumber: 1, revision: 9,
    run: { providerId: "fixture", sourceRunId: "run", enforcement: "EXACT_BEFORE_NEXT_ITEM", controls: ["CANCEL"],
      artifacts: inputs.map(input => ({ id: input.physicalId + "-artifact", sourceId: input.physicalId + "-source", digest: "retained-digest" })),
      events: [{ sourceEventId: "received", payload: "unchanged-payload" }], corrections: [],
      candidates: inputs.map((input, index) => ({ ...input, id: input.physicalId + "-database", identityKind: "DETECTION",
        expectedSides: ["FRONT"], provisional: false, uncertainty: [], revision: 3, excluded: index === 2,
        countConfirmed: true, proposal: { cardId: "proposed", finish: "NONFOIL" },
        review: { cardId: "reviewed", finish: "FOIL", condition: "LP", language: "FR", actorId: "human" },
        observations: [{ sourceId: input.physicalId + "-observation", artifactId: input.physicalId + "-artifact", side: "FRONT" }],
      })),
    },
  };
}
function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
}

test("actual hydration preserves one complete physical-order session for every database row permutation", () => {
  const row = fixture();
  const physicalOrder = ["p-a", "p-c", "p-b", "p-z"];
  const canonical = hydrate({ ...row, run: { ...row.run,
    candidates: physicalOrder.map(id => row.run.candidates.find(candidate => candidate.physicalId === id)!),
  } });
  const failures: string[][] = [];
  for (const candidates of permutations(row.run.candidates)) {
    const actual = hydrate({ ...row, run: { ...row.run, candidates } });
    const ids = actual.session.candidates.map((candidate: any) => candidate.input.id);
    if (JSON.stringify(ids) !== JSON.stringify(physicalOrder)) failures.push(ids);
    else assert.deepEqual(actual, canonical);
    assert.deepEqual(captureSummary(actual.session), captureSummary(canonical.session));
  }
  assert.equal(permutations(row.run.candidates).length, 24);
  console.log(JSON.stringify({ permutations: 24, incorrectCandidateOrders: failures.length }));
  assert.equal(failures.length, 0, "database relation row order must not change the complete hydrated capture");
});

test("actual hydration sorts a copy and retains candidate identity, observations and human review", () => {
  const row = fixture(), before = structuredClone(row);
  Object.freeze(row.run.candidates);
  const output = hydrate(row);
  assert.deepEqual(row, before);
  for (const candidate of row.run.candidates) {
    const projected = output.session.candidates.find((entry: any) => entry.input.id === candidate.physicalId);
    assert.equal(projected.key, candidateKey("run", candidate.physicalId));
    assert.deepEqual(projected.input.order, [candidate.acquisitionOrder, candidate.spatialOrder]);
    assert.deepEqual(projected.review, candidate.review);
    assert.deepEqual(projected.proposal, candidate.proposal);
    assert.equal(projected.excluded, candidate.excluded);
    assert.equal(projected.countConfirmed, candidate.countConfirmed);
    assert.equal(projected.revision, 3);
    assert.deepEqual(projected.observations, [{ id: candidate.physicalId + "-observation", artifactId: candidate.physicalId + "-source", side: "FRONT" }]);
  }
});
