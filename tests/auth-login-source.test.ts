import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAdminUser } from "../lib/auth-policy";

const authSource = readFileSync("lib/auth.ts", "utf8");
const adminPageSource = readFileSync("app/admin/page.tsx", "utf8");

test("login treats username and email identifiers case-insensitively", () => {
  assert.match(
    authSource,
    /username:\s*\{\s*equals:\s*cleanIdentifier,\s*mode:\s*"insensitive"\s*\}/,
  );
  assert.match(
    authSource,
    /email:\s*\{\s*equals:\s*cleanIdentifier,\s*mode:\s*"insensitive"\s*\}/,
  );
});

test("shared admin policy preserves configured username casing, roles and Player administration", () => {
  const prior = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = "CaseAdmin";
  try {
    assert.equal(isAdminUser({ username: "caseADMIN", role: "PLAYER" }), true);
    assert.equal(isAdminUser({ username: "ordinary", role: "ADMIN" }), true);
    assert.equal(
      isAdminUser({ username: "ordinary", role: "PLAYER" }, { isAdmin: true }),
      true,
    );
    assert.equal(
      isAdminUser({ username: "ordinary", role: "PLAYER" }, { isAdmin: false }),
      false,
    );
    assert.equal(isAdminUser(null, null), false);
  } finally {
    if (prior === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = prior;
  }
});

test("admin user management prevents case-only username duplicates", () => {
  assert.match(
    adminPageSource,
    /username:\s*\{\s*equals:\s*username,\s*mode:\s*"insensitive"/,
  );
  assert.match(adminPageSource, /id:\s*\{\s*not:\s*u\.id\s*\}/);
  assert.match(
    adminPageSource,
    /A user with that username or email already exists\./,
  );
});
