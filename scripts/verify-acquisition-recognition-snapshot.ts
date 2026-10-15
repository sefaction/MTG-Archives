import {recognitionSnapshotFailure} from "../lib/acquisition-recognition-snapshot-diagnostics";
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {loadAcquisitionRecognitionSnapshot} from '../lib/acquisition-recognition-snapshot';
import {createAcquisitionRecognitionIndex,proposeAcquisitionPrintings} from '../lib/acquisition-recognition';

// Invoked only by the enclosing disposable acquisition database verifier.
export async function verifyRecognitionSnapshot(db:PrismaClient){
  const prefix=`recognition-snapshot-${randomUUID()}-`;
  const id=(n:number)=>prefix+String(n).padStart(4,'0');
  const projection={id:true,scryfallId:true,name:true,printedName:true,cardFaces:true,
    setCode:true,collectorNumber:true,lang:true,digital:true} as const;
  const legacy=async()=>{
    const rows=await db.card.findMany({orderBy:{id:'asc'},select:projection});
    const cards=rows.map(({cardFaces,...card})=>({...card,faceNames:Array.isArray(cardFaces)?cardFaces.flatMap(f=>{
      const face=f as {name?:unknown;printed_name?:unknown};
      return [face?.name,face?.printed_name].filter((v):v is string=>typeof v==='string');
    }):[]}));
    return {digest:createHash('sha256').update(JSON.stringify(cards)).digest('hex'),
      index:createAcquisitionRecognitionIndex(cards),byScryfallId:new Map(cards.map(c=>[c.scryfallId,c]))};
  };
  try{
    const emptyExpected=await legacy();
    assert.deepEqual(await loadAcquisitionRecognitionSnapshot(db),emptyExpected);
    await db.card.createMany({data:Array.from({length:1025},(_,n)=>({id:id(n),scryfallId:randomUUID(),
      name:n===1024?'Éclair "quoted"\n // Back face':`Snapshot card ${n}`,printedName:n===1024?'Éclair':null,
      typeLine:'Artifact',setCode:'tst',collectorNumber:String(n),rarity:'common',lang:n===1024?'fr':'en',
      digital:n===1023,cardFaces:n===1024?[{name:'Éclair',printed_name:'Éclair imprimé',oracle_text:'not indexed'},
        {name:'Back face',printed_name:null},{name:12},null]:Prisma.DbNull}))});
    const expected=await legacy();
    const first=await loadAcquisitionRecognitionSnapshot(db);
    assert.deepEqual(first,expected,'bounded serialization and lookup structures must match the previous single-SELECT algorithm');
    assert.equal(await loadAcquisitionRecognitionSnapshot(db,first),first,'unchanged exact content must retain the immutable index');
    const example={title:['Snapshot card 17'],footer:['TST EN','C 17']};
    assert.deepEqual(proposeAcquisitionPrintings(first.index,example),proposeAcquisitionPrintings(expected.index,example));
    let pages=0;
    const racing={$transaction:<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>,options:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number})=>db.$transaction(async tx=>fn({card:{findMany:async(args:Prisma.CardFindManyArgs)=>{
      const rows=await tx.card.findMany(args);
      if(++pages===1){
        const cursor=rows.at(-1)!.id;
        assert(cursor.startsWith(prefix),'race control requires an owned cursor');
        assert(!rows.some(r=>r.id===id(1024)),'updated record must be on a later page');
        await db.$transaction([
          db.card.delete({where:{id:cursor}}),
          db.card.update({where:{id:id(1024)},data:{name:'Changed after first page',printedName:null}}),
          db.card.create({data:{id:cursor+'a',scryfallId:randomUUID(),name:'Inserted after cursor',typeLine:'Artifact',setCode:'tst',collectorNumber:'new',rarity:'common'}}),
        ]);
      }
      return rows;
    }}} as unknown as Prisma.TransactionClient),options)} as unknown as PrismaClient;
    const concurrent=await loadAcquisitionRecognitionSnapshot(racing,first);
    assert(pages>=3,'exercise multiple cursor pages');
    assert.equal(concurrent,first,'concurrent edit/delete/insert cannot mix generations across pages');
    const changed=await loadAcquisitionRecognitionSnapshot(db,first);
    assert.notEqual(changed,first);assert.notEqual(changed.digest,first.digest);
    assert.deepEqual(changed,await legacy(),'next refresh must observe committed changes with the exact legacy digest');
    await db.card.update({where:{id:id(17)},data:{rarity:'rare'}});
    assert.equal(await loadAcquisitionRecognitionSnapshot(db,changed),changed,'irrelevant catalogue changes do not replace recognition identity');
    const digestBefore=changed.digest;
    const failed={$transaction:<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>,options:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number})=>db.$transaction(async tx=>{
      let calls=0;return fn({card:{findMany:async(args:Prisma.CardFindManyArgs)=>{
        if(++calls===2)throw new Error('snapshot page failed');return tx.card.findMany(args);
      }}} as unknown as Prisma.TransactionClient);
    },options)} as unknown as PrismaClient;
    await assert.rejects(loadAcquisitionRecognitionSnapshot(failed,changed),/snapshot page failed/);
    assert.equal(changed.digest,digestBefore);
    // Short timers exist only in this disposable adapter; the production loader
    // must still request its unchanged 60-second transaction and 10-second wait.
    for(const mode of ['READ_PAGE','COMMIT_TRANSACTION'] as const){
      const expired={$transaction:<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>,options:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number})=>{
        assert.equal(options.timeout,60000);assert.equal(options.maxWait,10000);
        return db.$transaction(async tx=>{
          const result=await fn({card:{findMany:async(args:Prisma.CardFindManyArgs)=>{
            if(mode==='READ_PAGE')await new Promise(resolve=>setTimeout(resolve,400));
            return mode==='READ_PAGE'?tx.card.findMany({...args,where:{id:{startsWith:prefix}}}):[];
          }}} as unknown as Prisma.TransactionClient);
          if(mode==='COMMIT_TRANSACTION')await new Promise(resolve=>setTimeout(resolve,400));
          return result;
        },{...options,timeout:200});
      }} as unknown as PrismaClient;
      let caught:unknown;try{await loadAcquisitionRecognitionSnapshot(expired,changed);}catch(error){caught=error;}
      assert(caught instanceof Prisma.PrismaClientKnownRequestError);assert.equal(caught.code,'P2028');
      const report=recognitionSnapshotFailure(caught)!;assert.equal(report.phase,mode);
      assert.equal(report.pagesRead,mode==='READ_PAGE'?0:1);assert.equal(report.transactionCompleted,false);
      assert.equal(report.transactionTimeoutMs,60000);assert((report.elapsedMs??0)>=200);
      assert.equal(changed.digest,digestBefore,'a controlled failed refresh cannot mutate previous identity');
    }
    console.log('Recognition snapshot: exact legacy identity/index, bounded pages, unchanged reuse, concurrent edit/delete/insert, failure preservation and bounded transaction fault evidence pass.');
  }finally{
    await db.card.deleteMany({where:{id:{startsWith:prefix}}});
    assert.equal(await db.card.count({where:{id:{startsWith:prefix}}}),0);
  }
}
