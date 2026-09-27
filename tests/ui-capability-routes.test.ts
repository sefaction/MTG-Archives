import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? pageFiles(path)
      : entry.name === "page.tsx"
        ? [path]
        : [];
  });
}

test("capability crosswalk maps every current app page exactly once", () => {
  const routes = pageFiles("app").map((file) => {
    const parent = dirname(relative("app", file));
    return parent === "." ? "/" : `/${parent.split(sep).join("/")}`;
  });
  const ledger = readFileSync("docs/design/ui-consolidation/CAPABILITIES.md", "utf8");
  const mapped = [...ledger.matchAll(/^\| `([^`]+)` \|/gm)]
    .map((match) => match[1])
    .filter((route) => route.startsWith("/"));
  assert.equal(new Set(mapped).size, mapped.length, "duplicate crosswalk routes");
  assert.deepEqual(mapped.sort(), routes.sort());
});
