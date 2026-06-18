import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const decksPage = readFileSync("app/decks/page.tsx", "utf8");

test("deck rows use compact overflow actions instead of repeated large buttons", () => {
  assert.match(decksPage, /aria-label=\{`Actions for \$\{deck\.name\}`\}/);
  assert.match(decksPage, /Open deck/);
  assert.match(decksPage, /Move to folder/);
  assert.match(decksPage, /Save folder/);
  assert.match(decksPage, /Delete deck/);
  assert.doesNotMatch(decksPage, /View\/Edit/);
  assert.doesNotMatch(
    decksPage,
    /<SubmitButton[\s\S]{0,160}>\s*Move\s*<\/SubmitButton>/,
  );
});

test("folder sidebar renders as a compact tree with folder actions menu", () => {
  assert.match(decksPage, /aria-label="Deck folders"/);
  assert.match(decksPage, /renderFolderTree/);
  assert.match(decksPage, /border-l border-zinc-800/);
  assert.match(
    decksPage,
    /aria-label=\{`Folder actions for \$\{folder\.name\}`\}/,
  );
  assert.match(decksPage, /New subfolder/);
  assert.match(decksPage, /Delete folder/);
});

test("deck folder column displays nested path with tooltip", () => {
  assert.match(decksPage, /function folderPath/);
  assert.match(decksPage, /folderById\.get\(folderId\)\?\.path/);
  assert.match(decksPage, /title=\{folderPath\(deck\.folderId\)\}/);
  assert.match(decksPage, /\{folderPath\(deck\.folderId\)\}/);
});

test("create deck form is collapsed behind a compact new deck disclosure", () => {
  assert.match(decksPage, /\+ New deck/);
  assert.match(
    decksPage,
    /<details className="rounded border border-zinc-800 bg-zinc-950\/60 p-3">/,
  );
  assert.match(decksPage, /action=\{createDeck\}/);
});
