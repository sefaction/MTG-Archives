import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runVerification, verificationSteps } from "../lib/verification";

test("verification preserves full local checks and exposes an explicit core-only CI gate", () => {
  assert.deepEqual(verificationSteps(), [
    "prisma:generate",
    "typecheck",
    "test",
    "build",
    "ui:test",
  ]);
  assert.deepEqual(verificationSteps(true), [
    "prisma:generate",
    "typecheck",
    "test",
    "build",
  ]);
  const ran: string[] = [];
  assert.throws(
    () =>
      runVerification((step) => {
        ran.push(step);
        if (step === "test") throw new Error("fixture failure");
      }),
    /fixture failure/,
  );
  assert.deepEqual(ran, ["prisma:generate", "typecheck", "test"]);
});

test("CI uses read-only PR validation and gated serialized branch-head image publication", () => {
  const verify = readFileSync(".github/workflows/verify.yml", "utf8");
  const publish = readFileSync(".github/workflows/docker-publish.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(verify, /pull_request:/);
  assert.match(verify, /workflow_call:/);
  assert.match(verify, /npm run verify:core/);
  assert.doesNotMatch(verify, /pull_request_target|packages: write|secrets:/);
  assert.match(publish, /needs: verify/);
  assert.match(publish, /cancel-in-progress: false/);
  assert.match(publish, /push: false/);
  assert.match(publish, /steps\.fresh\.outputs\.current == 'true'/);
  assert.match(publish, /GITHUB_SHA/);
  assert.match(publish, /docker push/);
  assert.doesNotMatch(pkg.scripts.verify, /npm\.cmd/);
});
