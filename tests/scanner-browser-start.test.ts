import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readScannerStart, saveScannerStart, clearScannerStart, type PendingScannerStart } from "../lib/scanner-browser-start";
const intent = (): PendingScannerStart => ({ requestKey: randomUUID(), agentId: randomUUID(), deviceId: "source",
  locationId: "box", section: "A", quantity: null, loadedCount: null, operatorLoadedSimplexFronts: true,
  settings: { dpi: 600, widthInches: 2.6, heightInches: 3.6, horizontalPlacement: "Start", duplex: false,
    color: "RGB", autoCrop: false, deskew: false, removeBlank: false } });
function storage() { const rows = new Map<string, string>(); return { rows,
  getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
  removeItem: (key: string) => { rows.delete(key); } }; }
test("pending Start survives reload, isolates accounts, and cannot be erased by an old ACK", () => {
  const saved = storage(), first = intent(), next = intent(); saveScannerStart(saved, "owner", first);
  assert.deepEqual(readScannerStart(saved, "owner"), first); assert.equal(readScannerStart(saved, "other"), null);
  saveScannerStart(saved, "owner", next); clearScannerStart(saved, "owner", first.requestKey);
  assert.deepEqual(readScannerStart(saved, "owner"), next); clearScannerStart(saved, "owner", next.requestKey);
  assert.equal(readScannerStart(saved, "owner"), null);
});
test("malformed intent and unexpected secrets fail closed instead of generating a new identity", () => {
  const saved = storage(); saved.setItem("mtg-scanner-start-v1:owner", "invalid");
  assert.throws(() => readScannerStart(saved, "owner"));
  assert.throws(() => saveScannerStart(saved, "owner", { ...intent(), secret: "unexpected" } as PendingScannerStart));
  assert.throws(() => saveScannerStart({ ...saved, setItem() { throw new Error("unavailable"); } }, "owner", intent()), /unavailable/);
});
