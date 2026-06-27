import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(authSource, /ADMIN_USERNAME[\s\S]*?\.toLowerCase\(\)/);
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
