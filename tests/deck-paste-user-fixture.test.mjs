import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("October 21 supplied example remains byte-faithful, 87 rows and 100 copies", () => {
  const bytes = readFileSync(new URL("./fixtures/deck-paste-user-2026-10-21.txt", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "23a4a81ed1918f0718ca7a08b659caf24b25d6e65d3f9675ec021c5d7749c431");
  const rows = bytes.toString("utf8").split("\n");
  assert.equal(rows.length, 87);
  assert.equal(rows.reduce((sum, line) => sum + Number(line.match(/^\d+/)[0]), 0), 100);
  assert.deepEqual(rows.filter(line => line.includes("*F*")), ["1 Sol Ring (SLC) 19 *F*"]);
  assert.ok(rows.includes("1 Gohn, Town of Ruin (FIN) 278"));
});

test("public catalog projection proves every supplied printing, alias and finish", () => {
  const catalog = JSON.parse(readFileSync(new URL("./fixtures/deck-paste-public-catalog.json", import.meta.url), "utf8"));
  const text = readFileSync(new URL("./fixtures/deck-paste-user-2026-10-21.txt", import.meta.url), "utf8");
  assert.equal(catalog.fixtureSha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(catalog.cards.length, 87);
  assert.equal(new Set(catalog.cards.map(c => c.id)).size, 87);
  const rows = text.split("\n");
  for (const [i, row] of catalog.outcomes.entries()) {
    const raw = /^(\d+) (.+) \(([A-Z0-9]+)\) ([0-9]+)( \*F\*)?$/.exec(rows[i]);
    assert.ok(raw);
    assert.equal(row.raw, rows[i]);
    assert.equal(row.quantity, Number(raw[1]));
    const record = catalog.cards.find(c => c.id === row.card.id);
    assert.ok(record);
    const {projectionSHA256, ...projection} = record;
    assert.equal(projectionSHA256, createHash("sha256").update(JSON.stringify(projection)).digest("hex"));
    assert.equal(record.set, raw[3].toLowerCase());
    assert.equal(record.collector_number, raw[4]);
    assert.ok(record.finishes.includes(raw[5] ? "foil" : "nonfoil"));
    assert.equal(record.lang, "en");
    assert.equal(record.digital, false);
    assert.equal(raw[2], row.outcome === "EXACT_FLAVOR_NAME" ? record.flavor_name : record.name);
    assert.ok(["EXACT_NAME", "EXACT_FLAVOR_NAME"].includes(row.outcome));
  }
});
