import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deck detail page imports ensureDefaultLocation where it is used", async () => {
  const source = await readFile("app/decks/[deckId]/page.tsx", "utf8");

  assert.match(source, /ensureDefaultLocation\(prisma, inventoryOwnerId\)/);
  assert.match(
    source,
    /import\s*{[^}]*ensureDefaultLocation[^}]*}\s*from\s*["']@\/lib\/inventory-locations["']/s,
  );
});
