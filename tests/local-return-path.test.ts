import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { safeLocalReturnPath } from "../lib/local-return-path";

test("local return paths retain routes, queries and fragments", () => {
  for (const path of [
    "/",
    "/settings?tab=profile&view=compact",
    "/inventory?q=name%3AFire%2FIce#cards",
    "/decks/example",
    "/settings?text=https%3A%2F%2Fexample.invalid",
  ]) {
    assert.equal(safeLocalReturnPath(path), path);
  }
  assert.equal(safeLocalReturnPath("/inventory/../settings"), "/settings");
});

test("external, malformed and browser-normalized authority paths fall back safely", () => {
  for (const path of [
    undefined,
    null,
    1,
    {},
    "",
    "settings",
    "https://example.invalid",
    "http://example.invalid",
    "//example.invalid",
    "///example.invalid",
    "javascript:alert(1)",
    "/\\example.invalid",
    "\\\\example.invalid",
    " /settings",
    "/\t/example.invalid",
    "/\n/example.invalid",
    "/\r\nLocation:https://example.invalid",
    "/%2fexample.invalid",
    "/%5cexample.invalid",
    "/%0a/example.invalid",
    "/%",
    "/.//example.invalid",
    "/a/..//example.invalid",
  ]) {
    assert.equal(safeLocalReturnPath(path), "/dashboard");
  }
});

test("login validates submitted destinations and consumes the middleware next parameter", () => {
  const login = readFileSync("app/login/page.tsx", "utf8");
  assert.match(login, /safeLocalReturnPath\(formData\.get\("returnTo"\)\)/);
  assert.match(
    login,
    /safeLocalReturnPath\(params\.next \|\| params\.returnTo\)/,
  );
});
