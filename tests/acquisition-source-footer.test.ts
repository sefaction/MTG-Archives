import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceFooterSchema} from '../lib/acquisition-source-footer';
import {createAcquisitionRecognitionIndex,proposeAcquisitionPrintings,proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';
import {acquisitionCatalogQueries} from '../lib/acquisition-catalog-queries';
import {nativeSchema} from '../lib/acquisition-recognition-worker';
import {acquisitionReviewEvidence} from '../lib/acquisition-review-evidence';
const card={id:'sphere',name:"Commander's Sphere",setCode:'dmc',collectorNumber:'181',lang:'en'};
const index=createAcquisitionRecognitionIndex([card]);
const source={version:'source-footer-identifiers-v1',bounds:[24,1270,630,1396],rotationDegrees:0,status:'EXTRACTED',
  sourceQuad:[[20,1800],[900,1800],[900,2000],[20,2000]],width:880,height:200,sourceWidth:880,sourceHeight:200,sourceFrame:{width:1500,height:2024}};
test('source-only identifiers propose an exact printing while requiring review',()=>{
  const text={title:[card.name],footer:[],footerSourceIdentifiers:['DMC EN','U 0181']};
  const result=proposeAcquisitionPrintings(index,text);
  assert.equal(result.proposals[0].card.id,card.id);assert.equal(result.automaticAcceptance,false);
  assert(result.proposals[0].reasons.includes('RECOVERED_FOOTER_LAYOUT'));
  assert(acquisitionCatalogQueries([{rotationDegrees:0,text}]).printings.some(q=>q.kind==='printing'&&q.set==='dmc'&&q.number==='181'));
});
test('new source conflicts are preserved and directions cannot lend each other identifiers',()=>{
  const primary={title:[card.name],footer:['DMC EN','U 0181']};
  assert.equal(proposeAcquisitionPrintings(index,{...primary,footerSourceIdentifiers:['DMC EN','U 0181']}).automaticAcceptance,true);
  assert.equal(proposeAcquisitionPrintings(index,{...primary,footerSourceIdentifiers:['DMC FR','0182']}).automaticAcceptance,false);
  const result=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[card.name],footer:['0181']}},
    {rotationDegrees:180,text:{title:[],footer:[],footerSourceIdentifiers:['DMC EN']}}]);
  assert(!result.proposals.some(p=>p.reasons.includes('SET_AND_COLLECTOR_TEXT')));
});
test('source metadata rejects upsampling, padding, wrong windows and unavailable text',()=>{
  assert(sourceFooterSchema.safeParse(source).success);
  for(const changed of [{...source,width:900},{...source,sourceQuad:[[20,-1],...source.sourceQuad.slice(1)]},
    {...source,bounds:[0,0,1000,1397]},{...source,sourceFrame:{width:36000000,height:36000000}}])
    assert(!sourceFooterSchema.safeParse(changed).success);
  const text={title:[],footer:[],footerSourceIdentifiers:['DMC EN']};
  const native={version:1,descriptor:'a'.repeat(64),descriptorDetails:{},photoDigest:'b'.repeat(64),text,lines:[],
    orientations:[{rotationDegrees:0,text,lines:[],identifierLines:[{text:'DMC EN',score:.9,polygon:[[30,1300],[150,1300],[150,1330],[30,1330]]}],identifierSource:source}],geometry:{status:'PROPOSED',quad:[[0,0],[1499,0],[1499,2023],[0,2023]]},milliseconds:10,automaticAcceptance:false};
  assert(nativeSchema.safeParse(native).success);
  assert(!nativeSchema.safeParse({...native,geometry:{status:'NEEDS_CROP'}}).success);
  assert(!nativeSchema.safeParse({...native,orientations:[{...native.orientations[0],identifierSource:undefined}]}).success);
  assert(!nativeSchema.safeParse({...native,orientations:[{...native.orientations[0],identifierSource:{...source,rotationDegrees:180}}]}).success);
  const output={native:{...native,descriptorDetails:{privatePath:'not-for-ui'}},proposals:{evidence:{setCodes:['dmc'],collectors:['181'],languages:['en']}}};
  const evidence=acquisitionReviewEvidence(output);
  assert(evidence);assert.deepEqual(evidence.observations[0].text.footerSourceIdentifiers,['DMC EN']);
  assert.equal(JSON.stringify(evidence).includes('not-for-ui'),false);
  assert.equal(acquisitionReviewEvidence({...output,native:{...native,orientations:[{...native.orientations[0],identifierSource:undefined}]}}),null);
});
