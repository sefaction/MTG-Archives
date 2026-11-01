import assert from "node:assert/strict";
import test from "node:test";
import {acquisitionBatchLanguageCandidates,acquisitionObservedLanguages,acquisitionBatchLanguageAgrees,acquisitionObservedLanguageEvidence} from "../lib/acquisition-batch-language";
import {acquisitionFooterObservations} from "../lib/acquisition-footer";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings,type RecognitionCard,type RecognitionText} from "../lib/acquisition-recognition";
import {acquisitionDefaultsSchema,acquisitionPreferredPrinting,preserveAcquisitionDefaultChoices,type AcquisitionCardReview} from "../lib/acquisition-review";
import {acquisitionReviewEvidence} from "../lib/acquisition-review-evidence";

const card:RecognitionCard={id:"english",name:"Forest Guard",setCode:"abc",collectorNumber:"123a",lang:"en"};
const french={...card,id:"french",lang:"fr"};
const index=createAcquisitionRecognitionIndex([card,french]);
const text:RecognitionText={title:[card.name],footer:["R 123a","ABC"]};
const directions=(first:RecognitionText,second:RecognitionText={title:[],footer:[]})=>[
  {rotationDegrees:0,text:first},{rotationDegrees:180,text:second}];

test("explicit language completes only the missing language evidence without changing machine text",()=>{
  const input=directions(text),before=structuredClone(input);
  const machine=proposeOrientedAcquisitionPrintings(index,input);
  assert.equal(machine.automaticAcceptance,false);
  assert.deepEqual(acquisitionBatchLanguageCandidates(index,input),["en","fr"]);
  for(const language of ["en","fr"]){
    const result=proposeOrientedAcquisitionPrintings(index,input,12,language);
    assert.equal(result.status,"STRONG_MATCH");assert.equal(result.automaticAcceptance,true);
    const strong=result.proposals.filter(row=>row.reasons.includes("STRONG_EXACT_PRINTING"));
    assert.equal(strong.length,1);assert.equal(strong[0].card.lang,language);
    assert(strong[0].reasons.includes("LANGUAGE_FROM_CONFIRMED_BATCH"));
    assert.deepEqual(result.evidence.languages,[]);
    assert.equal("confirmedBatchLanguage" in result.evidence && result.evidence.confirmedBatchLanguage,language);
  }
  assert.deepEqual(input,before);assert.deepEqual(proposeOrientedAcquisitionPrintings(index,input),machine);
});

test("readable language conflicts remain conflicts and cannot generate a missing-language interpretation",()=>{
  const input=directions({...text,footer:["R 123a","ABC FR"]});
  assert.deepEqual(acquisitionObservedLanguages(input),["fr"]);
  assert.deepEqual(acquisitionBatchLanguageCandidates(index,input),[]);
  const conflict=proposeOrientedAcquisitionPrintings(index,input,12,"en");
  assert.equal(conflict.status,"CONFLICT");assert.equal(conflict.automaticAcceptance,false);
  assert.equal(proposeOrientedAcquisitionPrintings(index,input,12,"fr").automaticAcceptance,true);
  assert.equal(proposeOrientedAcquisitionPrintings(index,directions(text,{title:[],footer:["R 123a","ABC FR"]}),12,"en").automaticAcceptance,false);
  const mixed=directions({...text,footer:["R 123a","ABC EN"]},{title:[],footer:["ZZZ FR"]});
  assert.equal(proposeOrientedAcquisitionPrintings(index,mixed,12,"en").automaticAcceptance,false);
  assert.equal(acquisitionBatchLanguageAgrees({native:{orientations:mixed}},"en"),false);
  assert.equal(acquisitionBatchLanguageAgrees({native:{orientations:directions(text)}},"en"),true);
  assert.equal(acquisitionBatchLanguageAgrees({},"en"),false);
  const evidence=acquisitionReviewEvidence({native:{geometry:{status:"ACCEPTED"},orientations:mixed.map(row=>({...row,lines:[]}))},
    proposals:{evidence:{setCodes:["abc"],collectors:["123a"],languages:["en"]}}});
  assert.deepEqual(evidence?.identifiers.languages,["en","fr"]);
});

test("batch language cannot supply title, set, collector, layout, orientation, stamp or catalog uniqueness",()=>{
  for(const bad of [
    {...text,title:[]},{...text,title:["Forest Gvard"]},
    {...text,footer:["R 123a"]},{...text,footer:["ABC"]},
    {...text,footer:["R 123a","R 124","ABC"]},
    {...text,footer:["R 123a","ABC"],footerSupplemental:["R 124"]},
  ])assert.equal(proposeOrientedAcquisitionPrintings(index,directions(bad),12,"en").automaticAcceptance,false);
  assert.equal(proposeOrientedAcquisitionPrintings(index,directions(text,text),12,"en").automaticAcceptance,false);
  const duplicates=createAcquisitionRecognitionIndex([card,{...card,id:"duplicate"}]);
  assert.equal(proposeOrientedAcquisitionPrintings(duplicates,directions(text),1,"en").automaticAcceptance,false);
  const stamped=createAcquisitionRecognitionIndex([card,{...card,id:"list",setCode:"plst",collectorNumber:"ABC-123a"}]);
  assert.equal(proposeOrientedAcquisitionPrintings(stamped,directions(text),12,"en").automaticAcceptance,false);
  const numeric=createAcquisitionRecognitionIndex([{...card,setCode:"c13"}]);
  assert.equal(proposeOrientedAcquisitionPrintings(numeric,directions({...text,footer:["R 123a","C13"]}),12,"en").automaticAcceptance,false);
});

test("split language observations veto borrowed confirmation without creating a set/language identifier",()=>{
  const inputs=[
    directions({...text,footer:["R 123a","ABC","FR"]}),
    directions({...text,footer:["R 123a","ABC\nFR"]}),
    directions({...text,footer:["R 123a","ABC","(FR)"]}),
    directions({...text,footer:["R 123a","ABC","FR."]}),
    directions({...text,footerSupplemental:["FR"]}),
    directions({...text,footerSourceIdentifiers:[" FR "]}),
    directions(text,{title:[],footer:["FR"]}),
    directions({...text,footer:["R 123a","ABC EN"]},{title:[],footer:["ZZZ","FR"]}),
  ];
  for(const input of inputs){
    const before=structuredClone(input),ordinary=proposeOrientedAcquisitionPrintings(index,input);
    assert(acquisitionObservedLanguages(input).includes("fr"));
    assert.deepEqual(acquisitionBatchLanguageCandidates(index,input),[]);
    const result=proposeOrientedAcquisitionPrintings(index,input,12,"en");
    assert.equal(result.automaticAcceptance,false);assert.equal(result.status,"CONFLICT");
    assert.equal(acquisitionBatchLanguageAgrees({native:{orientations:input}},"en"),false);
    assert.deepEqual(input,before);assert.deepEqual(proposeOrientedAcquisitionPrintings(index,input),ordinary);
  }
  const split={...text,footer:["R 123a","ABC","FR"]};
  assert.deepEqual(acquisitionFooterObservations(split.footer).identifiers,[]);
  assert.equal(proposeOrientedAcquisitionPrintings(index,directions(split),12,"fr").automaticAcceptance,false,
    "agreement with an isolated code must not fabricate a positive identifier");
  const positioned=directions(split).map(row=>({...row,footerLines:row.text.footer.map((value,i)=>({text:value,
    polygon:[[20+i*50,1300],[60+i*50,1300],[60+i*50,1320],[20+i*50,1320]]}))}));
  assert.equal(proposeOrientedAcquisitionPrintings(index,positioned,12,"en").automaticAcceptance,false);
});

test("isolated supported language codes are bounded observations across channels and reading directions",()=>{
  for(const language of ["EN","FR","DE","IT","ES","PT","JA","KO","RU","ZHS","ZHT"]){
    const input=directions({...text,footer:["R 123a","ABC",` · ${language.toLowerCase()} • `]});
    assert.deepEqual(acquisitionObservedLanguages(input),[language.toLowerCase()]);
    assert.deepEqual(acquisitionBatchLanguageCandidates(index,input),[]);
  }
  for(const orientations of [[],directions(text).slice(0,1)])
    assert.equal(acquisitionObservedLanguageEvidence({native:{orientations}}),null);
  assert.equal(acquisitionObservedLanguageEvidence({native:{orientations:directions({...text,footer:Array(101).fill("FR")})}}),null);
});

test("optional batch language is explicit and legacy defaults retain their representation",()=>{
  const legacy={finish:"NONFOIL",condition:"NM"} as const;assert.deepEqual(acquisitionDefaultsSchema.parse(legacy),legacy);
  for(const language of [null,"en","fr"])assert.equal(acquisitionDefaultsSchema.parse({...legacy,language}).language,language);
  for(const language of ["","EN","english",true])assert.equal(acquisitionDefaultsSchema.safeParse({...legacy,language}).success,false);
  const previous={finish:"NONFOIL" as const,condition:"NM" as const,language:"fr" as const};
  assert.equal(preserveAcquisitionDefaultChoices({...previous,language:undefined,condition:"LP"},previous).language,"fr");
  assert.equal(preserveAcquisitionDefaultChoices({...previous,language:null},previous).language,null);
  const combined={...previous,openerPlayerId:"chosen-person"};
  assert.deepEqual(preserveAcquisitionDefaultChoices({...legacy,language:"en"},combined),
    {...legacy,language:"en",openerPlayerId:"chosen-person"},"a language-only client must not clear the explicit opener");
  assert.deepEqual(preserveAcquisitionDefaultChoices({...legacy,openerPlayerId:null},combined),
    {...legacy,language:"fr",openerPlayerId:null});
});

test("only unreviewed suggestions prefer the default; saved printing and language remain authoritative",()=>{
  const printing=(row:RecognitionCard)=>({...row,lang:row.lang??null,imageUri:null,finishes:["nonfoil"]});
  const record={defaults:{finish:"NONFOIL",condition:"NM",language:"fr"},printing:null,review:null,
    suggestions:[{printing:printing(card),reasons:[]},{printing:printing(french),reasons:[]}]} as Pick<AcquisitionCardReview,"defaults"|"printing"|"review"|"suggestions">;
  assert.equal(acquisitionPreferredPrinting(record)?.id,"french");
  assert.equal(acquisitionPreferredPrinting({...record,printing:printing(card)})?.id,"english");
  assert.equal(acquisitionPreferredPrinting({...record,defaults:{finish:"NONFOIL",condition:"NM"}})?.id,"english");
});
