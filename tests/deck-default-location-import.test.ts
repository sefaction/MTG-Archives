import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(
        (entry) => entry.name !== "node_modules" && entry.name !== ".next",
      )
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(fullPath);
        return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
      }),
  );
  return files.flat();
}

test("deck detail page imports ensureDefaultLocation where it is used", async () => {
  const source = await readFile("app/decks/[deckId]/page.tsx", "utf8");

  assert.match(source, /ensureDefaultLocation\(prisma, inventoryOwnerId\)/);
  assert.match(
    source,
    /import\s*{[^}]*ensureDefaultLocation[^}]*}\s*from\s*["']@\/lib\/inventory-locations["']/s,
  );
});

test("every ensureDefaultLocation caller imports or defines it", async () => {
  const files = await collectSourceFiles("app");
  files.push("lib/inventory-locations.ts");

  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/ensureDefaultLocation\(/.test(source)) continue;
    const definesHelper =
      /export\s+async\s+function\s+ensureDefaultLocation\b/.test(source);
    const importsHelper =
      /import\s*{[^}]*ensureDefaultLocation[^}]*}\s*from\s*["']@\/lib\/inventory-locations["']/s.test(
        source,
      );
    if (!definesHelper && !importsHelper) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});
