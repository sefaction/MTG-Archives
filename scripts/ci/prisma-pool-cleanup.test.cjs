const test = require('node:test');
const assert = require('node:assert/strict');
const cleanup = require('./prisma-pool-cleanup.cjs');
test('failed diagnostic and failed removal preserve both errors and still attempt every owned removal', () => {
  const removed = [], failures = [];
  cleanup(['db','web'], {
    collect: () => {throw new Error('logs unavailable');},
    remove: id => {removed.push(id);if(id==='web')throw new Error('owned removal failed');},
    failed: (error, phase, id) => failures.push({message:error.message,phase,id}),
  });
  assert.deepEqual(removed,['web','db']);
  assert.deepEqual(failures.map(x=>[x.phase,x.id]),[['diagnostic','web'],['removal','web'],['diagnostic','db']]);
});
