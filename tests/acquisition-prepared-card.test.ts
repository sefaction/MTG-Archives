import assert from 'node:assert/strict';
import test from 'node:test';
import {exactRecognitionCandidate,prepareRecognitionCard,preparedCardFromOutput,preparedCardSchema,samePreparedCard,applyPreparedInputPolicy} from '../lib/acquisition-prepared-card';
import {acquisitionNativePreparedInput,ACQUISITION_PREPARED_INPUT_MAX_BYTES} from '../lib/acquisition-image-input';
import {randomUUID} from 'node:crypto';
import {visualReuseIdentity,checkedVisualNative} from '../lib/acquisition-visual-reuse';
import {acquisitionReviewEvidence} from '../lib/acquisition-review-evidence';
import {sourceFooterSchema} from '../lib/acquisition-source-footer';
import {finalComparisonSchema} from '../lib/acquisition-printing';
const digest='a'.repeat(64);
const native={photoDigest:digest,geometry:{status:'PROPOSED',method:'scanner-white-card-edges',
  quad:[[10,20],[650,20],[650,920],[10,920]],sourceFrame:{width:700,height:1000}}};
const proposals={status:'STRONG_MATCH',totalProposals:1,orientation:{status:'SELECTED',rotationDegrees:180},
  proposals:[{card:{id:'card'},reasons:['STRONG_EXACT_PRINTING','SET_AND_COLLECTOR_TEXT']}]};
test('final agreement requires actual artwork and title observations beyond matching frame details',()=>{
  const result={version:'final-card-comparison-v1',automaticAcceptance:false,status:'CONSISTENT',measuredRegions:5,differentRegions:[]};
  assert.equal(finalComparisonSchema.safeParse(result).success,false);
  const identityRegions=['ARTWORK','TITLE'].map(region=>({region,status:'MEASURED',correlation:.95,colorResidual:5}));
  assert.equal(finalComparisonSchema.safeParse({...result,identityRegions}).success,true);
  assert.equal(finalComparisonSchema.safeParse({...result,identityRegions:[identityRegions[0],identityRegions[0]]}).success,false);
  assert.equal(finalComparisonSchema.safeParse({...result,identityRegions:[identityRegions[0],{...identityRegions[1],status:'UNREADABLE'}]}).success,false);
  assert.equal(finalComparisonSchema.safeParse({...result,status:'DIFFERENT',differentRegions:['FOOTER','FOOTER']}).success,false);
});
test('one original-space transform preserves selected direction and source bounds without overwriting the original',()=>{
  const frame=prepareRecognitionCard(native,proposals)!;
  assert.equal(frame.boundary,'OBSERVED');assert.equal(frame.rotationDegrees,180);
  assert.deepEqual(frame.region.quad[0],[10/699,20/999]);
  const bytes=Buffer.from('original');const envelope=acquisitionNativePreparedInput(bytes,'CARD_SCAN',frame);
  const n=envelope.readUInt32BE(0);const metadata=JSON.parse(envelope.subarray(4,4+n).toString());
  assert.deepEqual(metadata.preparedFrame,frame);assert.deepEqual(envelope.subarray(4+n),bytes);
});
test('unresolved direction, clipped frames, unlocated names and invalid/crossed corners never produce shared geometry',()=>{
  assert.equal(prepareRecognitionCard(native,{orientation:{status:'UNRESOLVED',rotationDegrees:null}}),undefined);
  for(const geometry of [{...native.geometry,framing:'CLIPPED'}, {...native.geometry,quad:[[0,0],[690,990],[690,0],[0,990]]},
    {...native.geometry,quad:[[-10,0],[650,0],[650,920],[0,920]]}])
    assert.equal(prepareRecognitionCard({...native,geometry},proposals),undefined);
  assert.equal(prepareRecognitionCard(native,{...proposals,proposals:[{reasons:['UNLOCALIZED_NAME_HINT']}]}),undefined);
});
test('inherited preparation cannot outlive its source geometry or selected direction',()=>{
  const preparation=prepareRecognitionCard(native,proposals)!;
  const output={photoId:'photo',native,proposals,preparation};
  assert.deepEqual(preparedCardFromOutput(output,digest),preparation);
  assert.equal(preparedCardFromOutput({...output,proposals:{...proposals,orientation:{status:'SELECTED',rotationDegrees:0}}},digest),undefined);
  assert.equal(preparedCardFromOutput({...output,native:{...native,geometry:{...native.geometry,framing:'CLIPPED'}}},digest),undefined);
});
test('maximum original plus prepared geometry and candidate hints fits the visual transport envelope',()=>{
  const preparation=prepareRecognitionCard(native,proposals)!;
  const bytes=Buffer.alloc(10*1024*1024,255);
  const envelope=acquisitionNativePreparedInput(bytes,'CARD_SCAN',preparation,preparation.region,Array.from({length:12},()=>randomUUID()));
  assert.ok(envelope.length>bytes.length+1024,'fixture crosses the old transport limit');
  assert.ok(envelope.length<=ACQUISITION_PREPARED_INPUT_MAX_BYTES);
  const n=envelope.readUInt32BE(0);assert.equal(n,envelope.length-bytes.length-4);
  assert.deepEqual(envelope.subarray(4+n),bytes);
});
test('internal-layout inference and explicit operator boundaries retain separate provenance',()=>{
  assert.equal(prepareRecognitionCard({...native,geometry:{...native.geometry,method:'internal-layout-v1'}},proposals)?.boundary,'INFERRED');
  assert.equal(prepareRecognitionCard({...native,geometry:{...native.geometry,method:'manual-card-region-v1'}},proposals)?.boundary,'OPERATOR');
});
test('only a single strong resolved identifier printing can take provisional candidate verification',()=>{
  const preparation=prepareRecognitionCard(native,proposals)!;
  assert.equal(exactRecognitionCandidate({preparation,proposals}),'card');
  for(const reasons of [['SET_AND_COLLECTOR_TEXT'],[...proposals.proposals[0].reasons,'LANGUAGE_CONFLICT'],
    [...proposals.proposals[0].reasons,'ORIENTATION_UNCERTAIN'],[...proposals.proposals[0].reasons,'TITLE_FRAGMENT']])
    assert.equal(exactRecognitionCandidate({preparation,proposals:{...proposals,proposals:[{card:{id:'card'},reasons}]}}),undefined);
  assert.equal(exactRecognitionCandidate({preparation,proposals:{...proposals,totalProposals:2}}),undefined);
  assert.equal(exactRecognitionCandidate({preparation,proposals:{...proposals,status:'REVIEW_REQUIRED'}}),undefined);
});
test('prepared geometry, direction and candidate scope bind reuse independently of original bytes',()=>{
  const preparation=prepareRecognitionCard(native,proposals)!;
  const identity=visualReuseIdentity({version:1,ownerPlayerId:'owner',photoDigest:digest,descriptor:'b'.repeat(64),inputKind:'CARD_SCAN',preparation});
  const {key: _key,...request}=identity;
  const changed=visualReuseIdentity({...request,preparation:{...preparation,rotationDegrees:0}});
  assert.notEqual(changed.key,identity.key);assert.equal(samePreparedCard(changed.preparation,preparation),false);
  assert.throws(()=>checkedVisualNative({version:1,descriptor:'b'.repeat(64),photoDigest:digest,referenceCount:1,
    unavailableCount:0,geometry:{status:'PROPOSED',preparedFrame:changed.preparation},inputRegion:'CARD',
    candidates:[],milliseconds:1,automaticAcceptance:false},identity),/identity/);
  assert.equal(preparedCardSchema.safeParse({...preparation,sourceWidth:36000000}).success,false);
});
test('new adaptive readings withhold automatic authority but can retain a provisional exact route',()=>{
  const input={...proposals,automaticAcceptance:true};
  const cautious=applyPreparedInputPolicy(input,{geometry:{method:'contours'},orientations:[{readingZones:{footer:{top:1248}}}]});
  assert.equal(cautious.automaticAcceptance,false);assert.equal(cautious.status,'REVIEW_REQUIRED');
  assert.equal(exactRecognitionCandidate({preparation:prepareRecognitionCard(native,proposals),proposals:cautious}),'card');
  assert.equal(input.automaticAcceptance,true);
  assert.equal(applyPreparedInputPolicy(input,{geometry:{method:'contours'},orientations:[]}),input);
});
test('review uses shared original-space geometry and direction but withholds preparation digests',()=>{
  const preparation=prepareRecognitionCard(native,proposals)!;
  const evidence=acquisitionReviewEvidence({preparation,native:{...native,orientations:[]},
    proposals:{orientation:proposals.orientation,evidence:{setCodes:[],collectors:[],languages:[]}}})!;
  assert.equal(evidence.rotation,180);
  assert.deepEqual(evidence.geometry.quad,native.geometry.quad);
  assert.equal(evidence.preparation?.boundary,'OBSERVED');
  assert.ok(!JSON.stringify(evidence).includes(digest));
  assert.equal(acquisitionReviewEvidence({preparation:{...preparation,photoDigest:'c'.repeat(64)},
    native:{...native,orientations:[]},proposals:{evidence:{setCodes:[],collectors:[],languages:[]}}}),null);
});
test('legacy source bounds stay exact while adaptive source windows are explicitly versioned',()=>{
  const unavailable={version:'source-footer-identifiers-v1',bounds:[24,1270,630,1396],rotationDegrees:0,
    status:'UNAVAILABLE',reason:'TIME_BUDGET'};
  assert.equal(sourceFooterSchema.safeParse(unavailable).success,true);
  assert.equal(sourceFooterSchema.safeParse({...unavailable,bounds:[24,1248,630,1396]}).success,false);
  assert.equal(sourceFooterSchema.safeParse({...unavailable,version:'source-footer-adaptive-v2',bounds:[24,1248,630,1396]}).success,true);
  assert.equal(sourceFooterSchema.safeParse({...unavailable,version:'source-footer-adaptive-v2',bounds:[24,700,630,1396]}).success,false);
});
