import assert from "node:assert/strict";
import test from "node:test";
import { scannerReservedSpace } from "../lib/scanner-capacity";
test("scanner reservation includes unfed target and pending cards without double counting committed copies",()=>{
  assert.equal(scannerReservedSpace({reserved:83,candidateCount:10,slotCount:10,committedCount:0}),83);
  assert.equal(scannerReservedSpace({reserved:83,candidateCount:83,slotCount:83,committedCount:1}),82);
  assert.equal(scannerReservedSpace({reserved:10,candidateCount:10,slotCount:10,committedCount:10}),0);
});
test("pending photos, unfinished slots and retained overfeed consume capacity conservatively",()=>{
  assert.equal(scannerReservedSpace({reserved:null,candidateCount:3,slotCount:4,committedCount:1}),3);
  assert.equal(scannerReservedSpace({reserved:1,candidateCount:2,slotCount:2,committedCount:0}),2);
});
