import test from 'node:test';
import assert from 'node:assert/strict';
import {setSymbolSchema,setSymbolMessage,consistentSetSymbol} from '../lib/acquisition-set-symbol';
const family='a'.repeat(16),other='b'.repeat(16);
const observed={status:'SIMILAR',reason:'SHAPE_COMPARISON',matches:[{family,codes:['AFR','XDND'],similarity:.97},{family:other,codes:['SPM'],similarity:.80}],box:[40,30,50,50]};
const evidence={version:'expansion-symbol-shapes-v1',bounds:[790,745,960,900],automaticAcceptance:false,query:observed,reference:observed,relation:'SIMILAR_SHAPE'};
test('shared icon aliases stay a cue rather than an exact printing probability',()=>{
  const parsed=setSymbolSchema.parse(evidence),message=setSymbolMessage(parsed);
  assert.match(message.observed,/AFR, XDND/);assert.match(message.comparison,/exact printing still needs review/);
});
test('unknown and old analyses never manufacture absent symbols or a match',()=>{
  assert.equal(setSymbolMessage(undefined).observed,'Not checked');
  const value=setSymbolSchema.parse({...evidence,query:{status:'UNREADABLE',reason:'REGION_CLIPPED'},relation:'UNRESOLVED'});
  assert.equal(setSymbolMessage(value).observed,'Unclear');
  assert.equal(setSymbolSchema.safeParse({...value,relation:'SIMILAR_SHAPE'}).success,false);
});
test('weak, repeated and out-of-region shape claims are rejected',()=>{
  for(const query of [{...observed,box:[160,30,50,50]},
    {...observed,matches:[{...observed.matches[0],similarity:.89},observed.matches[1]]},
    {...observed,matches:[observed.matches[0],observed.matches[0]]}])assert.equal(setSymbolSchema.safeParse({...evidence,query}).success,false);
});
test('relation follows both observed families and cannot grant acceptance',()=>{
  const reference={...observed,matches:[{...observed.matches[0],family:other}, {...observed.matches[1],family}]};
  assert.equal(setSymbolSchema.safeParse({...evidence,reference}).success,false);
  assert.equal(setSymbolSchema.safeParse({...evidence,reference,relation:'DIFFERENT_SHAPE'}).success,true);
  assert.equal(setSymbolSchema.safeParse({...evidence,automaticAcceptance:true}).success,false);
});
test('conflicting face alignments cannot present a single supported query icon',()=>{
  const parsed=setSymbolSchema.parse(evidence);
  const different=setSymbolSchema.parse({...evidence,query:{...observed,matches:[{...observed.matches[0],family:other},{...observed.matches[1],family}]},relation:'DIFFERENT_SHAPE'});
  assert.equal(consistentSetSymbol([parsed,different]),undefined);
  assert.equal(consistentSetSymbol([undefined,parsed,parsed]),parsed);
});
