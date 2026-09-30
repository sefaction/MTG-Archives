import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { persistScannerStartRetirement, scannerStartRetired } from "../lib/scanner-control-files";

test("scanner retirement is durable, identity-bound and fails closed on malformed evidence",async()=>{
  const parent=path.resolve(".local-data");await mkdir(parent,{recursive:true});
  const root=await mkdtemp(path.join(parent,"scanner-retire-test-")),prior=process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH=root;
  try {
    const id=randomUUID(),epoch=randomUUID(),request={requestKey:id,settings:{dpi:600}};
    assert.equal(await scannerStartRetired(id),false);
    await persistScannerStartRetirement(id,"fixture-owner",epoch,request);
    assert.equal(await scannerStartRetired(id),true);
    const file=path.join(root,"scanner-control-v1",`${id}.retired.json`),original=await readFile(file,"utf8");
    await persistScannerStartRetirement(id,"fixture-owner",randomUUID(),request);
    assert.equal(await readFile(file,"utf8"),original); // restore/retry keeps original epoch and identity
    await assert.rejects(persistScannerStartRetirement(id,"different-owner",epoch,request));
    await assert.rejects(persistScannerStartRetirement(id,"fixture-owner",epoch,{...request,settings:{dpi:300}}));
    assert.equal(await readFile(file,"utf8"),original);
    await writeFile(file,"{}");await assert.rejects(scannerStartRetired(id));
    await assert.rejects(scannerStartRetired("../escape"));
  } finally {
    if(prior===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=prior;
    if(path.dirname(root)!==parent||!path.basename(root).startsWith("scanner-retire-test-"))throw Error("Fixture escaped");
    await rm(root,{recursive:true,force:true});
  }
});
