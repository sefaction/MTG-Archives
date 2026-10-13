import test from 'node:test';
import assert from 'node:assert/strict';
import {scannerLayoutTemplateSchema} from '../lib/acquisition-scanner-layout';
import {nativeSchema} from '../lib/acquisition-recognition-worker';
const template={version:1,policy:'scanner-layout-anchor-v1',sourceDigest:'a'.repeat(64),sourceMethod:'manual-card-region-v1',
  frame:{width:1700,height:2300},region:{version:1,quad:[[50/1699,30/2299],[1650/1699,30/2299],[1650/1699,2270/2299],[50/1699,2270/2299]]},
  anchors:[{kind:'COLLECTOR',point:[40/999,1320/1396]},{kind:'TITLE',point:[60/999,115/1396]}]};
const text={title:['First Card'],footer:['R 0177']};
const lines=[{text:'First Card',score:.97,polygon:[[60,80],[500,80],[500,115],[60,115]]},{text:'R 0177',score:.98,polygon:[[40,1290],[150,1290],[150,1320],[40,1320]]}];
const native={version:1,descriptor:'b'.repeat(64),descriptorDetails:{},photoDigest:'a'.repeat(64),
  geometry:{status:'PROPOSED',method:'manual-card-region-v1',quad:[[50,30],[1650,30],[1650,2270],[50,2270]]},
  text,lines,orientations:[{rotationDegrees:0,text,lines}],milliseconds:2,automaticAcceptance:false,scannerLayoutTemplate:template};

test('scanner layout requires bounded corners, one collector and distinct observed anchor kinds',()=>{
  assert(scannerLayoutTemplateSchema.safeParse(template).success);
  for(const changed of [{...template,sourceMethod:'declared-card-scan'},
    {...template,anchors:[template.anchors[1]]},{...template,anchors:[template.anchors[0],template.anchors[0]]},
    {...template,anchors:[{...template.anchors[0],point:[.1,.4]}]},
    {...template,frame:{width:36000000,height:36000000}},{...template,expectedCardId:'not-a-layout-input'}])
    assert(!scannerLayoutTemplateSchema.safeParse(changed).success);
});

test('a layout template cannot borrow another source digest, geometry or declared outline',()=>{
  assert(nativeSchema.safeParse(native).success);
  for(const changed of [{...native,photoDigest:'c'.repeat(64)},
    {...native,orientations:[{rotationDegrees:0,text,lines:[]}]},
    {...native,geometry:{...native.geometry,method:'declared-card-scan'}},
    {...native,geometry:{...native.geometry,quad:[[51,30],[1650,30],[1650,2270],[50,2270]]}},
    {...native,geometry:{...native.geometry,framing:'CLIPPED'}}])
    assert(!nativeSchema.safeParse(changed).success);
});


import {acquisitionNativePhotoInput} from '../lib/acquisition-image-input';
import {assertScannerLayoutInference,combineScannerLayoutReadings} from '../lib/acquisition-scanner-layout-reading';
import {createAcquisitionRecognitionIndex} from '../lib/acquisition-recognition';
const profile=scannerLayoutTemplateSchema.parse(template);
function inferredNative(){
  const targetLines=lines.map(line=>({...line,text:line.text==='First Card'?'Different Card':'U 0042',
    polygon:line.polygon.map(([x,y])=>[(50+x/999*1600+8)/1699*999,(30+y/1396*2240-6)/2299*1396])}));
  return nativeSchema.parse({...native,scannerLayoutTemplate:undefined,
    geometry:{status:'PROPOSED',method:'declared-card-scan',quad:[[0,0],[1699,0],[1699,2299],[0,2299]]},
    orientations:[{rotationDegrees:0,text:{title:['First Card'],footer:['R 0177','TST EN']},lines:targetLines},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],
    scannerLayout:{inference:{status:'PROPOSED',policy:'scanner-layout-anchor-v1',boundaryVerified:false,
      sourceDigest:profile.sourceDigest,observedAnchors:['COLLECTOR','TITLE'],rotationDegrees:0,offsetPixels:[8,-6],
      region:{version:1,quad:profile.region.quad.map(([x,y])=>[x+8/1699,y-6/2299])}},readingStatus:'COMPLETE',
      orientations:[{rotationDegrees:0,text:{title:['Different Card'],footer:['U 0042','TST EN']},lines:[]},
        {rotationDegrees:180,text:{title:[],footer:[]},lines:[]}]}});
}
test('native scanner hint preserves source bytes, excludes manual/photo-text scope and fits its fixed bound',()=>{
  const bytes=Buffer.from('original scanner image'),raw=JSON.stringify(profile);
  const frame=acquisitionNativePhotoInput(bytes,'CARD_SCAN',undefined,undefined,raw),size=frame.readUInt32BE();
  assert(size<=1020);assert.deepEqual(frame.subarray(4+size),bytes);
  assert.equal(JSON.parse(frame.subarray(4,4+size).toString()).scannerLayoutProfile,raw);
  assert.throws(()=>acquisitionNativePhotoInput(bytes,'PHOTO',undefined,undefined,raw));
  assert.throws(()=>acquisitionNativePhotoInput(bytes,'CARD_SCAN',undefined,profile.region,raw));
  assert.throws(()=>acquisitionNativePhotoInput(bytes,'CARD_SCAN','WHOLE_PHOTO_TEXT',undefined,raw));
});
test('inferred source corners must reconstruct from observed printed positions, with no clipping or source substitution',()=>{
  const target=inferredNative();assertScannerLayoutInference(profile,target);
  for(const change of [()=>target.scannerLayout!.inference.status==='PROPOSED'&&(target.scannerLayout!.inference.offsetPixels[0]+=2),
    ()=>target.scannerLayout!.inference.status==='PROPOSED'&&(target.scannerLayout!.inference.sourceDigest='e'.repeat(64)),
    ()=>target.orientations[0].lines.splice(0),()=>((target.geometry.quad as number[][])[1][0]+=30)]){
    const clean=inferredNative();Object.assign(target,clean);change();assert.throws(()=>assertScannerLayoutInference(profile,target));
  }
  assert(!nativeSchema.safeParse({...inferredNative(),geometry:{status:'NEEDS_CROP',framing:'CLIPPED'}}).success);
});
test('layout readings retain primary conflicts and cannot manufacture automatic printing acceptance',()=>{
  const index=createAcquisitionRecognitionIndex([{id:'first',name:'First Card',setCode:'tst',collectorNumber:'177',lang:'en'},
    {id:'second',name:'Different Card',setCode:'tst',collectorNumber:'42',lang:'en'}]);
  const target=inferredNative(),before=structuredClone(target);
  const result=combineScannerLayoutReadings(index,target);
  assert.equal(result.status,'CONFLICT');assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(new Set(result.proposals.map(p=>p.card.id)),new Set(['first','second']));
  assert(result.proposals.every(p=>p.reasons.includes('SCANNER_LAYOUT_INFERRED')&&!p.reasons.includes('STRONG_EXACT_PRINTING')));
  assert.deepEqual(target,before);
});

import {acquisitionReviewEvidence} from '../lib/acquisition-review-evidence';
test('review projects inferred observations without exposing the saved source fingerprint',()=>{
  const target=inferredNative();
  const proposals={orientation:{status:'UNRESOLVED',rotationDegrees:null},evidence:{setCodes:[],collectors:[],languages:[]}};
  const projected=acquisitionReviewEvidence({native:target,proposals});
  assert.equal(projected?.scannerLayout?.readingStatus,'COMPLETE');
  assert(!JSON.stringify(projected).includes(profile.sourceDigest));
  const later=acquisitionReviewEvidence({native:{...target,scannerLayout:undefined},primaryScannerLayout:target.scannerLayout,proposals});
  assert.deepEqual(later?.scannerLayout,projected?.scannerLayout);
});
