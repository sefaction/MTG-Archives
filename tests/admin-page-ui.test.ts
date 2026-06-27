import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminPage = readFileSync("app/admin/page.tsx", "utf8");

test("admin page uses dashboard panels and compact management disclosures", () => {
  assert.match(adminPage, /System console/);
  assert.match(adminPage, /Admin tools/);
  assert.match(adminPage, /Physical cards/);
  assert.match(adminPage, /Scryfall service/);
  assert.match(adminPage, /<details>[\s\S]*Create user/);
  assert.match(adminPage, /<summary[\s\S]*Account[\s\S]*<\/summary>/);
  assert.match(adminPage, /<summary[\s\S]*Reset Password[\s\S]*<\/summary>/);
  assert.match(adminPage, /Password reset required/);
});

test("admin page uses shared compact dark controls instead of raw chunky fields", () => {
  assert.match(adminPage, /const inputClass =/);
  assert.match(adminPage, /const primaryButtonClass =/);
  assert.doesNotMatch(adminPage, /className="border p-2 bg-zinc-900"/);
  assert.doesNotMatch(adminPage, /className="border px-3 py-2"/);
});
