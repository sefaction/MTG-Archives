import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryBrowser = readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
const inventoryListRoute = readFileSync(
  "app/api/inventory/list/route.ts",
  "utf8",
);
const publicInventoryPage = readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);
const publicInventoryListRoute = readFileSync(
  "app/api/public/inventory/list/route.ts",
  "utf8",
);

test("inventory table row actions use a compact overflow menu", () => {
  assert.match(
    inventoryBrowser,
    /aria-label=\{`Actions for \$\{row\.original\.cardName\}`\}/,
  );
  assert.match(inventoryBrowser, /View details/);
  assert.match(inventoryBrowser, /Edit inventory/);
  assert.match(inventoryBrowser, /Delete inventory/);
  assert.match(inventoryBrowser, /absolute right-0 z-20/);
  assert.doesNotMatch(
    inventoryBrowser,
    /<button[\s\S]{0,140}>\s*Edit\s*<\/button>/,
  );
  assert.doesNotMatch(
    inventoryBrowser,
    /<button[\s\S]{0,140}>\s*Delete\s*<\/button>/,
  );
});

test("inventory edit workflow exposes stack split and merge controls", () => {
  assert.match(inventoryBrowser, /Copies by location/);
  assert.match(inventoryBrowser, /onSplitInventoryStack/);
  assert.match(inventoryBrowser, /inventoryItemId/);
  assert.match(inventoryBrowser, /Split stack/);
  assert.match(inventoryBrowser, /Save stack/);
  assert.match(inventoryBrowser, /Matching stacks merge automatically/);
  assert.match(inventoryBrowser, /Use deck return/);
  assert.match(inventoryBrowser, /capabilities\.canEdit \? \(/);
});

test("inventory detail drawer uses readable card information blocks", () => {
  assert.match(inventoryBrowser, /type InventoryCardFace =/);
  assert.match(inventoryBrowser, /function CardImageFlipper/);
  assert.match(inventoryBrowser, /function InventoryDetailPanel/);
  assert.match(inventoryBrowser, /getInventoryCardImagePair/);
  assert.match(inventoryBrowser, /Show back face/);
  assert.match(inventoryBrowser, /Show front face/);
  assert.match(inventoryBrowser, /aria-label=\{currentLabel\}/);
  assert.match(inventoryBrowser, /function normalizeCardFaces/);
  assert.match(inventoryBrowser, /function CardFaceMechanics/);
  assert.match(inventoryBrowser, /const cardFaces = normalizeCardFaces\(row\)/);
  assert.match(inventoryBrowser, /showFaceNames=\{!cardFaces\.length\}/);
  assert.match(inventoryBrowser, /const hasPowerToughness = Boolean/);
  assert.match(inventoryBrowser, /const hasLoyalty = Boolean/);
  assert.match(inventoryBrowser, /const treatment =/);
  assert.match(inventoryBrowser, />\s*Printing\s*<\/div>/);
  assert.match(inventoryBrowser, /symbolClassName="h-5 w-5"/);
  assert.match(inventoryBrowser, />\s*Treatment\s*<\/div>/);
  assert.match(inventoryBrowser, />\s*Legalities\s*<\/div>/);
  assert.match(inventoryBrowser, /const legalityFormats =/);
  assert.match(
    inventoryBrowser,
    /grid min-h-8 grid-cols-\[minmax\(0,1fr\)_4\.75rem\]/,
  );
  assert.match(inventoryBrowser, /truncate text-xs font-medium/);
  assert.match(inventoryBrowser, /inline-flex h-5 w-full/);
  assert.match(inventoryBrowser, />\s*Inventory\s*<\/div>/);
  assert.match(inventoryBrowser, />\s*Price\s*<\/div>/);
  assert.match(
    inventoryBrowser,
    /<aside className="space-y-3 text-sm">[\s\S]*<CardImageFlipper row=\{row\} \/>[\s\S]*<InventoryDetailPanel/,
  );
  assert.equal(
    (inventoryBrowser.match(/>\s*Inventory\s*<\/div>/g) || []).length,
    1,
  );
  assert.match(inventoryBrowser, /\[transform-style:preserve-3d\]/);
  assert.match(inventoryBrowser, /\[backface-visibility:hidden\]/);
  assert.match(inventoryBrowser, /motion-reduce:transition-none/);
  assert.match(inventoryBrowser, /visibleLocationBreakdown/);
  assert.match(inventoryBrowser, /View on Scryfall/);
  assert.doesNotMatch(inventoryBrowser, /Location Summary/);
  assert.doesNotMatch(inventoryBrowser, /Scryfall fallback prices/);
  assert.doesNotMatch(inventoryBrowser, /Preferred price/);
  assert.doesNotMatch(inventoryBrowser, /<b>Colors:<\/b>/);
});

test("inventory rows include face data for split multi-face cards", () => {
  for (const source of [
    inventoryPage,
    inventoryListRoute,
    publicInventoryPage,
    publicInventoryListRoute,
  ]) {
    assert.match(
      source,
      /cardFaces: Array\.isArray\(i\.card\.cardFaces\) \? i\.card\.cardFaces : \[\]/,
    );
  }
});
