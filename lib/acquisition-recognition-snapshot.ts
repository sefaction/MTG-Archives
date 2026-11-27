import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Prisma,type PrismaClient} from '@prisma/client';
import {createAcquisitionRecognitionIndex,type RecognitionCard} from './acquisition-recognition';
import {recordRecognitionSnapshotFailure,type RecognitionSnapshotFailure} from './acquisition-recognition-snapshot-diagnostics';

export type RecognitionSnapshot={digest:string;
  index:ReturnType<typeof createAcquisitionRecognitionIndex>;
  byScryfallId:Map<string,RecognitionCard>};
const projection={id:true,scryfallId:true,name:true,printedName:true,cardFaces:true,
  setCode:true,collectorNumber:true,lang:true,digital:true,layout:true} as const;
const PAGE_SIZE=512;

export async function loadAcquisitionRecognitionSnapshot(db:PrismaClient,previous?:RecognitionSnapshot):Promise<RecognitionSnapshot>{
  const started=performance.now();
  let phase:RecognitionSnapshotFailure["phase"]="BEGIN_TRANSACTION",phaseStarted=started;
  let transactionStarted:number|undefined,transactionFinished:number|undefined;
  let pagesRead=0,rowsRead=0,completedReadMs=0,maxCompletedReadMs=0,completedHashMs=0;
  const enter=(next:RecognitionSnapshotFailure["phase"])=>{phase=next;phaseStarted=performance.now();};
  try {
    const cards:(RecognitionCard & {scryfallId:string})[]=[];
    const hash=createHash('sha256').update('[');
    // Every page sees the same committed catalogue, including concurrent edits
    // and deletes. Do not replace exact content identity with a timestamp/count.
    await db.$transaction(async tx=>{
      transactionStarted=performance.now();
      let cursor:string|undefined;
      for(;;){
        enter("READ_PAGE");
        const rows=await tx.card.findMany({where:{scryfallId:{not:null}},orderBy:{id:'asc'},select:projection,take:PAGE_SIZE,
          ...(cursor===undefined?{}:{cursor:{id:cursor},skip:1})});
        const readMs=performance.now()-phaseStarted;
        completedReadMs+=readMs;maxCompletedReadMs=Math.max(maxCompletedReadMs,readMs);
        pagesRead++;rowsRead+=rows.length;
        enter("HASH_ROWS");
        for(const {cardFaces,...row} of rows){
          if (!row.scryfallId) continue;
          const card:RecognitionCard & {scryfallId:string}={...row,scryfallId:row.scryfallId,faceNames:Array.isArray(cardFaces)?cardFaces.flatMap(f=>{
            const face=f as {name?:unknown;printed_name?:unknown};
            return [face?.name,face?.printed_name].filter((v):v is string=>typeof v==='string');
          }):[]};
          if(cards.length)hash.update(',');
          hash.update(JSON.stringify(card));cards.push(card);
        }
        completedHashMs+=performance.now()-phaseStarted;
        if(rows.length<PAGE_SIZE)break;
        cursor=rows[rows.length-1].id;
      }
      enter("COMMIT_TRANSACTION");
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:60000});
    transactionFinished=performance.now();
    enter("BUILD_INDEX");
    const digest=hash.update(']').digest('hex');
    // Identical content keeps the same immutable lookup structures; constructing
    // another name/printing index cannot improve the current observation.
    if(previous?.digest===digest)return previous;
    return {digest,index:createAcquisitionRecognitionIndex(cards),
      byScryfallId:new Map(cards.map(card=>[card.scryfallId,card]))};
  } catch(error) {
    const now=performance.now();
    recordRecognitionSnapshotFailure(error,{phase,elapsedMs:now-started,phaseElapsedMs:now-phaseStarted,
      transactionMs:transactionStarted===undefined?null:(transactionFinished??now)-transactionStarted,
      completedReadMs,maxCompletedReadMs,completedHashMs,pagesRead,rowsRead,
      callbackEntered:transactionStarted!==undefined,transactionCompleted:transactionFinished!==undefined});
    throw error;
  }
}

const profileIndexes=new WeakMap<RecognitionSnapshot,Map<string,RecognitionSnapshot>>();
export function recognitionSnapshotForProfile(snapshot:RecognitionSnapshot,profile:string){
 if(profile==='STANDARD')return snapshot;
 if(profile!=='ART'&&profile!=='TOKEN')throw Error('Unknown recognition profile.');
 let cache=profileIndexes.get(snapshot);if(!cache){cache=new Map();profileIndexes.set(snapshot,cache);}
 const previous=cache.get(profile);if(previous)return previous;
 const cards=[...snapshot.byScryfallId.entries()].filter(([,card])=>profile==='ART'?card.layout==='art_series':['token','double_faced_token'].includes(card.layout??''));
 const scoped={...snapshot,index:createAcquisitionRecognitionIndex(cards.map(([,card])=>card)),byScryfallId:new Map(cards)};
 cache.set(profile,scoped);return scoped;
}
