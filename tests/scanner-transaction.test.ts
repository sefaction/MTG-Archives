import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { scannerTransaction } from "../lib/scanner-store";
test("scanner retries the whole rolled-back raw serialization/deadlock transaction",async()=>{
  for (const code of ["40001","40P01"]) {
    let calls=0;
    const db={$transaction:async()=>{if(++calls===1)throw new Prisma.PrismaClientKnownRequestError("fixture",{code:"P2010",clientVersion:"fixture",meta:{code}});return 7;}} as unknown as PrismaClient;
    assert.equal(await scannerTransaction(db,async()=>7),7);assert.equal(calls,2);
  }
});
test("scanner genuine database errors propagate without a retry",async()=>{
  const error=new Prisma.PrismaClientKnownRequestError("fixture",{code:"P2010",clientVersion:"fixture",meta:{code:"XX000"}});
  let calls=0;
  const db={$transaction:async()=>{calls++;throw error;}} as unknown as PrismaClient;
  await assert.rejects(scannerTransaction(db,async()=>0),e=>e===error);assert.equal(calls,1);
});
