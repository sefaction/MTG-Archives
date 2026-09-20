import assert from "node:assert/strict";
import test from "node:test";
import { checkClientManifest } from "../lib/build-client-manifests";

const route = "/imports/page";
function manifest(
  path: string,
  chunks: unknown[] = ["7", "static/chunks/imports.js"],
) {
  return `globalThis.__RSC_MANIFEST = ${JSON.stringify({
    [route]: { clientModules: { [path]: { id: 7, chunks } } },
  })}`;
}

test("client build guard accepts emitted Windows and Linux references and chunks", () => {
  for (const path of [
    "/app/components/SingleCardInventoryAdd.tsx",
    "C:\\repo\\components\\SingleCardInventoryAdd.tsx",
  ]) {
    checkClientManifest(
      manifest(path),
      route,
      ["SingleCardInventoryAdd"],
      (chunk) => chunk === "static/chunks/imports.js",
    );
  }
});

test("client build guard rejects the observed missing Imports component", () => {
  assert.throws(
    () =>
      checkClientManifest(
        manifest("/app/components/InventoryExportForm.tsx"),
        route,
        ["SingleCardInventoryAdd"],
        () => true,
      ),
    /missing client reference for SingleCardInventoryAdd/,
  );
});

test("client build guard resolves encoded dynamic route chunk paths", () => {
  checkClientManifest(
    manifest("/app/components/SingleCardInventoryAdd.tsx", [
      "static/chunks/app/decks/%5BdeckId%5D/page.js",
    ]),
    route,
    ["SingleCardInventoryAdd"],
    (path) => path === "static/chunks/app/decks/[deckId]/page.js",
  );
});

test("client build guard rejects missing route maps and chunk files", () => {
  const path = "/app/components/SingleCardInventoryAdd.tsx";
  assert.throws(
    () =>
      checkClientManifest(
        "globalThis.__RSC_MANIFEST = {}",
        route,
        [],
        () => true,
      ),
    /missing client module map/,
  );
  assert.throws(
    () =>
      checkClientManifest(
        manifest(path),
        route,
        ["SingleCardInventoryAdd"],
        () => false,
      ),
    /missing\/invalid client chunk/,
  );
  assert.throws(
    () =>
      checkClientManifest(
        manifest(path, []),
        route,
        ["SingleCardInventoryAdd"],
        () => true,
      ),
    /no client chunks/,
  );
});
