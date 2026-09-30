import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { acquisitionPhotoTextSchema, combineAcquisitionPhotoText, needsAcquisitionPhotoText,
  readAcquisitionPhotoText, UNLOCALIZED_NAME_HINT, type AcquisitionPhotoText } from "../lib/acquisition-photo-text";
import { acquisitionCatalogQueries } from "../lib/acquisition-catalog-queries";
import { combineAcquisitionCandidates } from "../lib/acquisition-visual";
import { acquisitionNativePhotoInput } from "../lib/acquisition-image-input";
import { acquisitionReviewEvidence } from "../lib/acquisition-review-evidence";

const card = { id: "original", name: "Forest Guard", setCode: "abc", collectorNumber: "1", lang: "en" };
const index = createAcquisitionRecognitionIndex([card,
  { ...card, id: "stamped", setCode: "plst", collectorNumber: "ABC-1" }]);
const empty = () => proposeOrientedAcquisitionPrintings(index, []);
const hints = (text: string[]): AcquisitionPhotoText => ({ version: 1, scope: "WHOLE_PHOTO", status: "COMPLETE",
  readings: [{ rotationDegrees: 0, text, truncated: false }] });

test("whole-photo names retrieve original/stamped candidates without inventing title/footer agreement", () => {
  const base = empty();
  const result = combineAcquisitionPhotoText(index, base, hints(["Forest Guard", "ABC EN", "C 0001"]));
  assert.deepEqual(new Set(result.proposals.map(p => p.card.id)), new Set(["original", "stamped"]));
  assert.equal(result.automaticAcceptance, false);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.evidence, { setCodes: [], collectors: [], languages: [] });
  assert.deepEqual(result.orientation, base.orientation);
  assert.ok(result.proposals.every(p => p.reasons.includes(UNLOCALIZED_NAME_HINT) &&
    !p.reasons.includes("TITLE_EXACT") && !p.reasons.includes("SET_AND_COLLECTOR_TEXT")));
  assert.equal(base.proposals.length, 0);
  for (const text of [["Forest Gvard"], ["When you cast Forest Guard"], ["ABC EN", "C 1"]])
    assert.equal(combineAcquisitionPhotoText(index, base, hints(text)), base);
});

test("supported short titles retain the fast path; fuzzy/unknown titles can request fallback", () => {
  const short = createAcquisitionRecognitionIndex([{ ...card, name: "Fog" }]);
  const result = proposeOrientedAcquisitionPrintings(short, [0,180].map(rotationDegrees =>
    ({ rotationDegrees, text: { title: rotationDegrees ? [] : ["Fog"], footer: [] } })));
  assert.equal(needsAcquisitionPhotoText(result), false);
  assert.equal(needsAcquisitionPhotoText(empty()), true);
  const fuzzy = proposeOrientedAcquisitionPrintings(index, [0,180].map(rotationDegrees =>
    ({ rotationDegrees, text: { title: rotationDegrees ? [] : ["Forest Gvard"], footer: [] } })));
  assert.equal(needsAcquisitionPhotoText(fuzzy), true);
  assert.equal(combineAcquisitionPhotoText(short, result), result);
});

test("independent image evidence can retain a printing beyond the first twelve same-name hints", () => {
  const cards = Array.from({length:30},(_,i)=>({...card,id:String(i)}));
  const large = createAcquisitionRecognitionIndex(cards);
  const text = combineAcquisitionPhotoText(large, proposeOrientedAcquisitionPrintings(large, []),
    hints([card.name]), ["25"]);
  assert.equal(text.totalProposals, 30);assert.equal(text.proposals[0].card.id,"25");
  const unrelated={...card,id:"other",name:"River Guard"};
  const union=combineAcquisitionCandidates(text,{candidates:[{scryfallId:"other"},{scryfallId:"25"}]},
    new Map([...cards,unrelated].map(c=>[c.id,c])));
  assert.equal(union.proposals[0].card.id,"25");assert.equal(union.automaticAcceptance,false);
});

test("whole-photo catalog hints are bounded name lookups, never printing/language evidence", () => {
  const photo=hints(["Forest Guard", "NEW EN", "C 0099"]);
  const queries=acquisitionCatalogQueries([],photo);
  assert.deepEqual(queries.printings,[]);assert.deepEqual(queries.names,[]);
  assert.ok(queries.photoTextNames!.some(q=>q.kind==="name"&&q.name===card.name));
  assert.ok(queries.photoTextNames!.every(q=>q.kind==="name"));
  assert.ok(queries.photoTextNames!.length<=4);
  assert.equal(acquisitionPhotoTextSchema.safeParse({...photo,readings:[photo.readings[0],photo.readings[0]]}).success,false);
  assert.equal(acquisitionPhotoTextSchema.safeParse(hints(["x".repeat(201)])).success,false);
});

test("fallback command preserves original bytes and rejects stale photo/model evidence", async () => {
  const bytes=Buffer.from([255,216,255,224,1,2,3]);
  const expected={photoDigest:"a".repeat(64),descriptor:"b".repeat(64)};
  const controller=new AbortController();
  const request=async(frame:Buffer)=>{
    const length=frame.readUInt32BE(0);
    assert.deepEqual(JSON.parse(frame.subarray(4,4+length).toString()),{inputKind:"PHOTO",recognitionTask:"WHOLE_PHOTO_TEXT"});
    assert.deepEqual(frame.subarray(4+length),bytes);
    return {...expected,recognitionTask:"WHOLE_PHOTO_TEXT",photoText:hints([card.name])};
  };
  assert.equal((await readAcquisitionPhotoText(request,bytes,"PHOTO",expected,controller.signal)).status,"COMPLETE");
  for(const wrong of [{photoDigest:"c".repeat(64)},{descriptor:"d".repeat(64)},{recognitionTask:"OTHER"}]){
    const result=await readAcquisitionPhotoText(async frame=>({...await request(frame),...wrong}),bytes,"PHOTO",expected,controller.signal);
    assert.equal(result.status,"UNAVAILABLE");assert.deepEqual(result.readings,[]);
  }
  assert.throws(()=>acquisitionNativePhotoInput(bytes,"PHOTO","OTHER" as any));
});

test("bounded fallback failure retains primary evidence while outer cancellation still propagates", async () => {
  const expected={photoDigest:"a".repeat(64),descriptor:"b".repeat(64)},signal=new AbortController().signal;
  const result=await readAcquisitionPhotoText(async(_input,attemptSignal)=>{
    await setTimeout(50,undefined,{signal:attemptSignal});throw new Error("not reached");
  },Buffer.from("photo"),"PHOTO",expected,signal,3);
  assert.equal(result.status,"UNAVAILABLE");assert.equal(result.reason,"TIME_BUDGET");
  const base=empty();assert.equal(combineAcquisitionPhotoText(index,base,result),base);
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(readAcquisitionPhotoText(async()=>{throw new Error("must not run")},
    Buffer.from("photo"),"PHOTO",expected,cancelled.signal));
});

test("review keeps unlocalized readings separate and withholds private worker metadata", () => {
  const evidence=acquisitionReviewEvidence({native:{geometry:{status:"NEEDS_CROP"},orientations:[],
    photoText:{...hints([card.name]),privatePath:"omit"},descriptorDetails:{privatePath:"omit"}},
    proposals:empty()})!;
  assert.ok(evidence);assert.deepEqual(evidence.observations,[]);assert.equal(evidence.geometry.status,"NEEDS_CROP");
  assert.equal(evidence.photoText!.readings[0].text[0],card.name);
  assert.deepEqual(evidence.identifiers,{setCodes:[],collectors:[],languages:[]});
  assert.ok(!JSON.stringify(evidence).includes("omit"));
});

test("completed identity-bound reading survives a later internal deadline without inventing printing", async () => {
  const expected={photoDigest:"a".repeat(64),descriptor:"b".repeat(64)};
  const result=await readAcquisitionPhotoText(async(_input,attemptSignal,progress)=>{
    progress!({...expected,progress:true,recognitionTask:"WHOLE_PHOTO_TEXT",photoText:{...hints([card.name]),status:"PARTIAL"}});
    await setTimeout(100,undefined,{signal:attemptSignal});throw Error("not reached");
  },Buffer.from("photo"),"PHOTO",expected,new AbortController().signal,10);
  assert.equal(result.status,"PARTIAL");assert.equal(result.reason,"TIME_BUDGET");
  assert.equal(result.readings[0].text[0],card.name);
  const proposed=combineAcquisitionPhotoText(index,empty(),result);
  assert.equal(proposed.automaticAcceptance,false);
  assert.ok(proposed.proposals.every(p=>p.reasons.includes(UNLOCALIZED_NAME_HINT)));
  assert.deepEqual(proposed.evidence,{setCodes:[],collectors:[],languages:[]});
});

test("contradictory progress or final identity drops completed readings; outer abort propagates", async () => {
  const expected={photoDigest:"a".repeat(64),descriptor:"b".repeat(64)};
  const step={...expected,progress:true,recognitionTask:"WHOLE_PHOTO_TEXT",photoText:{...hints([card.name]),status:"PARTIAL"}};
  for(const kind of ["duplicate","stale-progress","stale-final","changed-final","omitted-final"]){
    const result=await readAcquisitionPhotoText(async(_input,_signal,progress)=>{
      progress!(step);
      if(kind==="changed-final")return {...step,photoText:hints(["Different name"])};
      if(kind==="omitted-final")return {...step,photoText:{...hints([]),readings:[]}};
      if(kind!=="stale-final")progress!(kind==="duplicate"?step:{...step,photoDigest:"c".repeat(64)});
      return {...step,descriptor:"d".repeat(64)};
    },Buffer.from("photo"),"PHOTO",expected,new AbortController().signal);
    assert.equal(result.status,"UNAVAILABLE");assert.deepEqual(result.readings,[]);
  }
  const cancelled=new AbortController();
  await assert.rejects(readAcquisitionPhotoText(async(_input,signal,progress)=>{
    progress!(step);cancelled.abort();signal.throwIfAborted();
  },Buffer.from("photo"),"PHOTO",expected,cancelled.signal));
});
