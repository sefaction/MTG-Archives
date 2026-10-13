import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlledReviewTarget} from './ui/controlled-review-target';
test('controlled fixtures bind only to the two known local review applications',()=>{
  assert.deepEqual(controlledReviewTarget('mtg-archives-web-1'),{container:'mtg-archives-web-1',baseURL:'http://127.0.0.1:13001',project:'mtg-archives'});
  assert.deepEqual(controlledReviewTarget('mtg-anchor-qualification-web-1'),{container:'mtg-anchor-qualification-web-1',baseURL:'http://127.0.0.1:13011',project:'mtg-anchor-qualification'});
});
test('unknown or remote fixture targets are rejected before data operations',()=>{
  for(const value of ['production-web-1','mtg-archives-web-2','http://example.com','ssh://host','', '../mtg-archives-web-1'])assert.throws(()=>controlledReviewTarget(value),/supported local/);
});
