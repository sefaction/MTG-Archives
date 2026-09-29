import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionNativePhotoInput, acquisitionImageInputKindSchema } from "../lib/acquisition-image-input";

test("declared scan envelope preserves all original bytes and raw photo compatibility", () => {
  const bytes=Buffer.from([255,216,255,224,1,2,3,4]);
  assert.equal(acquisitionNativePhotoInput(bytes,"PHOTO"),bytes);
  const scan=acquisitionNativePhotoInput(bytes,"CARD_SCAN"),length=scan.readUInt32BE(0);
  assert.deepEqual(JSON.parse(scan.subarray(4,4+length).toString()),{inputKind:"CARD_SCAN"});
  assert.deepEqual(scan.subarray(4+length),bytes);
  assert(!acquisitionImageInputKindSchema.safeParse("scanner-driver-setting").success);
  assert.throws(()=>acquisitionNativePhotoInput(Buffer.alloc(10*1024*1024+1),"CARD_SCAN"));
});
