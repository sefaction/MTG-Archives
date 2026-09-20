// Synthetic, read-only CPU benchmark; no database, card names or user data.
import { performance } from "node:perf_hooks";
import { compareInventoryGroups } from "../lib/inventory-sort";

const size = 10_000;
let seed = 20260920;
const cards = new Map<string, any>();
const groups = Array.from({ length: size }, (_, index) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const id = `card-${index}`;
  cards.set(id, {
    name: `Synthetic card ${seed % size}`,
    collectorNumber: String(index),
  });
  return { cardId: id, _sum: { quantity: 1 } };
});
for (let iteration = 1; iteration <= 3; iteration++) {
  const start = performance.now();
  const compare = (a: any, b: any) =>
    compareInventoryGroups(a, b, cards, "cardName", "asc");
  // Existing page pipeline sorts a copy twice before taking its first page.
  [...groups].sort(compare);
  [...groups].sort(compare);
  console.log(
    JSON.stringify({
      iteration,
      groups: size,
      twoSortsMs: Math.round(performance.now() - start),
    }),
  );
}
