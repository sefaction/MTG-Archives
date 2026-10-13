import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {currentAcquisitionReferenceInput} from '../lib/acquisition-reference-worker';
import {AcquisitionJobSupersededError} from '../lib/acquisition-jobs';
import {REFERENCE_REGION_POLICY} from '../lib/acquisition-reference-region';

function input(){
  const hash='a'.repeat(64);
  return {version:1,photoId:randomUUID(),digest:hash,generation:1,model:hash,
    primaryVersion:hash,catalog:hash,referenceModel:hash,catalogResolver:'current',
    candidateRevision:0,lineageKey:hash,parents:{recognitionJobId:randomUUID(),recognitionOutputHash:hash,
      catalogJobId:randomUUID(),catalogOutputHash:hash,printingJobId:randomUUID(),printingOutputHash:hash},
    reference:{version:1,policy:REFERENCE_REGION_POLICY,references:[randomUUID()+':0'],
      region:{version:1,quad:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]}}};
}
test('current reference input retains identity and finite coordinates',()=>{
  const value=input();assert.deepEqual(currentAcquisitionReferenceInput(value),value);
});
test('complete retired policy consumes its queued attempt without coercing the outline',()=>{
  const value=input();value.reference.policy='distributed-reference-region-v1';const before=structuredClone(value);
  assert.throws(()=>currentAcquisitionReferenceInput(value),AcquisitionJobSupersededError);
  assert.deepEqual(value,before);
});
test('malformed old policy stays a validation failure',()=>{
  const value=input();value.reference.policy='distributed-reference-region-v1';value.reference.region.quad[0][0]=NaN;
  assert.throws(()=>currentAcquisitionReferenceInput(value),ZodError);
});
test('unknown policy is not silently classified as known obsolete work',()=>{
  const value=input();value.reference.policy='unknown-policy';
  assert.throws(()=>currentAcquisitionReferenceInput(value),ZodError);
});
test('unknown envelope version is not silently retired',()=>{
  const value=input();value.reference.policy='distributed-reference-region-v1';value.version=2;
  assert.throws(()=>currentAcquisitionReferenceInput(value),ZodError);
});
