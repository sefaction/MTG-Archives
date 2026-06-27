import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const themes = readFileSync("lib/themes.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260627120000_user_theme/migration.sql",
  "utf8",
);
const layout = readFileSync("app/layout.tsx", "utf8");
const settings = readFileSync("app/settings/page.tsx", "utf8");
const globals = readFileSync("app/globals.css", "utf8");

test("theme registry defines six selectable app themes", () => {
  const ids = Array.from(themes.matchAll(/id: "([^"]+)"/g)).map(
    (match) => match[1],
  );
  assert.deepEqual(ids, [
    "golgari",
    "azorius",
    "izzet",
    "selesnya",
    "rakdos",
    "lotus",
  ]);
  assert.match(themes, /DEFAULT_APP_THEME = "golgari"/);
  assert.match(themes, /normalizeAppTheme/);
});

test("user theme is persisted with a safe default", () => {
  assert.match(schema, /theme\s+String\s+@default\("golgari"\)/);
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'golgari'/,
  );
});

test("root layout applies the current user's normalized theme", () => {
  assert.match(layout, /getCurrentUser/);
  assert.match(layout, /normalizeAppTheme\(user\?\.theme\)/);
  assert.match(layout, /<html lang="en" data-theme=\{theme\}>/);
});

test("settings page renders and saves per-user theme selection", () => {
  assert.match(settings, /APP_THEMES\.map/);
  assert.match(settings, /name="theme"/);
  assert.match(settings, /normalizeAppTheme\(fd\.get\("theme"\)\)/);
  assert.match(settings, /theme,/);
});

test("global stylesheet exposes theme tokens for each app theme", () => {
  for (const id of [
    "golgari",
    "azorius",
    "izzet",
    "selesnya",
    "rakdos",
    "lotus",
  ]) {
    assert.match(globals, new RegExp(`data-theme="${id}"`));
  }
  assert.match(globals, /--app-bg:/);
  assert.match(globals, /--app-surface:/);
  assert.match(globals, /--app-accent:/);
  assert.match(globals, /\.app-panel/);
});
