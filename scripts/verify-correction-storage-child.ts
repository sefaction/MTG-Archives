import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { runCorrectionCaptureOnce } from "../lib/acquisition-correction-worker";
assert.equal(process.env.MTG_LOCAL_PILOT_TEST,"1");
assert.equal(new URL(process.env.DATABASE_URL!).hostname,"correction-restore-fixture");
const mode=process.argv[2],blobId=process.argv[3];
assert.ok(["ENOSPC","EACCES"].includes(mode));
assert.equal(process.env.UPLOADS_DATA_PATH,mode==="ENOSPC"?"/failure-space":"/drill/permission-space");
const db=new PrismaClient();
async function main() {
  const before=await db.correctionRetentionPin.count({where:{blobId,releasedAt:null}}); assert.ok(before);
  assert.deepEqual(await runCorrectionCaptureOnce(db),{claimed:1,preserved:0,failed:1});
  const job=await db.correctionCaptureOutbox.findUniqueOrThrow({where:{blobId}});
  assert.equal(job.status,"PENDING"); assert.equal(job.errorCode,mode);
  assert.equal(job.leaseToken,null); assert.equal(job.leaseExpiresAt,null);
  const blob=await db.correctionBlob.findUniqueOrThrow({where:{id:blobId}});
  assert.equal(blob.state,"PENDING"); assert.equal(blob.reserved,true);
  assert.equal(await db.correctionRetentionPin.count({where:{blobId,releasedAt:null}}),before);
  console.log(`PASS real ${mode}: retryable copy, reserved accounting and all source pins retained`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
