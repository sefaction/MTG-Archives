import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Prisma, type PrismaClient} from "@prisma/client";
import {acquisitionHandoffQuery} from "../lib/acquisition-handoff";

export async function verifyAcquisitionHandoff(db: PrismaClient) {
  const oldRun=randomUUID(), freshRun=randomUUID();
  const old=Array.from({length:64},(_,n)=>({id:`old-${n}`,runId:oldRun,createdAt:new Date(Date.UTC(2000,0,1,0,0,n))}));
  const fresh=Array.from({length:3},(_,n)=>({id:`fresh-${n}`,runId:freshRun,createdAt:new Date(Date.UTC(2026,0,1,0,0,n))}));
  async function select(rows: typeof old, stage: string) {
    const values=Prisma.join(rows.map(row=>Prisma.sql`(${row.id},${row.runId},${row.createdAt})`));
    return db.$queryRaw<{id:string}[]>(acquisitionHandoffQuery(stage,Prisma.sql`
      SELECT id::text, "runId"::text, "createdAt"::timestamp
      FROM (VALUES ${values}) AS input(id,"runId","createdAt")`));
  }
  for(const stage of ['photo-recognition-v1','photo-visual-retrieval-v1',
    'photo-catalog-reconciliation-v1','photo-printing-evidence-v1']) {
    const selected=await select([...old,...fresh],stage);
    assert.equal(selected.length,32);
    assert.deepEqual(selected.filter(row=>row.id.startsWith('fresh-')).map(row=>row.id),fresh.map(row=>row.id),
      'new ready sources enter despite more than32 older ready sources');
    assert.deepEqual(selected.filter(row=>row.id.startsWith('old-')).map(row=>row.id),old.slice(0,29).map(row=>row.id),
      'source order within the older run remains FIFO');
    assert.deepEqual((await select(old,stage)).map(row=>row.id),old.slice(0,32).map(row=>row.id),
      'a single ready run still fills the32-row window');
    const many=old.slice(0,40).map(row=>({...row,runId:randomUUID()}));
    assert.equal((await select(many,stage)).length,32,'many runs do not widen the admission bound');
  }
  console.log('PASS: four bounded handoffs admit new runs past64 older sources, preserve FIFO and retain32-row single-run throughput');
}
