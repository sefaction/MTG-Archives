import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionLoadProgress} from './acquisition-load-progress';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const printing = (id = 'original', candidateId: string | null = 'card-1', input: unknown = {}) =>
  ({id, candidateId, stage: 'photo-printing-evidence-v1', status: 'COMPLETE', input});
const reference = {id: 'reference', candidateId: 'card-1', stage: 'photo-reference-refinement-v1', status: 'COMPLETE', input: {parents: {printingJobId: 'original'}}};
const refined = () => printing('refined', 'card-1', {referenceSource: {referenceJobId: reference.id}});

test('ordinary printing retains the original one-result-per-card count', () => {
  assert.equal(acquisitionLoadProgress([printing(), printing('second', 'card-2')]).readyCandidates, 2);
});
test('retained original and refined jobs count one card, not two jobs', () => {
  const jobs = [printing(), reference, refined()];
  assert.equal(jobs.filter(job => job.stage === 'photo-printing-evidence-v1').length, 2, 'old row-count assumption rejects this valid one-card pipeline');
  assert.deepEqual(acquisitionLoadProgress(jobs), {completedCandidates: 1, printingJobs: 2, pending: 0, missingReferencePrinting: 0, missingReferenceAdmission: 0, readyCandidates: 1});
});
test('missing refined printing cannot qualify an already printed card', () => {
  const result = acquisitionLoadProgress([printing(), reference]);
  assert.equal(result.missingReferencePrinting, 1); assert.equal(result.readyCandidates, 0);
});
for (const status of ['PENDING', 'RUNNING']) test(status + ' work prevents early qualification', () => {
  assert.equal(acquisitionLoadProgress([printing(), {...reference, status}]).readyCandidates, 0);
});
test('failed work remains a failure even with complete printing', () => {
  assert.throws(() => acquisitionLoadProgress([printing(), {...reference, status: 'FAILED'}]), /Native fixture job failed/);
});
test('superseded optional refinement does not prevent ordinary completion', () => {
  assert.equal(acquisitionLoadProgress([printing(), {...reference, status: 'SUPERSEDED'}]).readyCandidates, 1);
});
test('enabled refinement cannot qualify the gap before reference admission', () => {
  const result = acquisitionLoadProgress([printing()], true);
  assert.equal(result.missingReferenceAdmission, 1); assert.equal(result.readyCandidates, 0);
  assert.equal(acquisitionLoadProgress([printing(), {...reference, status: 'SUPERSEDED'}], true).readyCandidates, 1);
  assert.equal(acquisitionLoadProgress([printing(), reference, refined()], true).readyCandidates, 1);
});
test('unrelated reference lineage cannot satisfy admission', () => {
  assert.equal(acquisitionLoadProgress([printing(), {...reference, status: 'SUPERSEDED', input: {parents: {printingJobId: 'other'}}}], true).readyCandidates, 0);
});
test('two descendants for one reference fail rather than inflate completion', () => {
  assert.throws(() => acquisitionLoadProgress([printing(), reference, refined(), {...refined(), id: 'duplicate'}]), /lineage/);
});
test('a descendant from another candidate cannot satisfy refinement', () => {
  assert.throws(() => acquisitionLoadProgress([printing(), reference, {...refined(), candidateId: 'foreign'}]), /lineage/);
});
test('a malformed completed printing cannot become a counted card', () => {
  assert.throws(() => acquisitionLoadProgress([printing('invalid', null)]), /no candidate/);
});
test('empty or incomplete native queues do not create completed candidates', () => {
  assert.equal(acquisitionLoadProgress([]).readyCandidates, 0);
  assert.equal(acquisitionLoadProgress([{...printing(), status: 'RUNNING'}]).completedCandidates, 0);
});

test('actual large-batch poll counts four owners and waits for a reference descendant', async () => {
  const source = readFileSync(new URL('./ui/acquisition-large-batch.spec.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('large.ts', source, ts.ScriptTarget.Latest, true);
  let poll: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.body.getText(tree).includes('const groups=owners.map(owner=>acquisitionLoadProgress(')) poll = node;
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(poll, 'Exercise the actual workflow poll');
  const code = ts.transpileModule('(' + poll.getText(tree) + ')', {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  let includeDescendant = false;
  const report = {progress: [] as unknown[]}, calls: string[] = [];
  const context = {
    acquisitionLoadProgress, referenceRefinementEnabled: false, owners: ['0', '1', '2', '3'].map(tag => ({tag})), report, save: () => {},
    database: (body: string) => {
      calls.push(body);
      assert.match(body, /ownerPlayerId:/); assert.match(body, /candidateId:true,stage:true,status:true,input:true/);
      return body.includes('ownerPlayerId:"0"') ? [printing(), reference, ...(includeDescendant ? [refined()] : [])] : [printing()];
    },
  };
  const callback = vm.runInNewContext(code, context);
  assert.equal(await callback(), 3, 'The incomplete owner cannot qualify');
  includeDescendant = true;
  assert.equal(await callback(), 4, 'Two printing jobs for owner zero still count one card');
  assert.equal(calls.length, 8); assert.equal(report.progress.length, 2);
  // Execute the actual emitted database query body. Ordinary job inputs can be
  // large; only lineage IDs should cross the synchronous Docker output pipe.
  const largeJobs = [printing(), reference, refined(), ...Array.from({length: 2100}, (_,i) =>
    ({...printing('job-'+i, 'card-'+i), input: {unusedNativeDetail: 'x'.repeat(4096)}}))];
  assert.ok(Buffer.byteLength(JSON.stringify(largeJobs)) > 1024*1024, 'Unprojected job inputs exceed the original output bound');
  let emitted = '';
  await vm.runInNewContext('(async()=>{' + calls[0] + '})()', {
    p: {acquisitionProcessingJob: {findMany: async () => largeJobs}},
    console: {log: (data: string) => {emitted = data;}},
  });
  assert.ok(Buffer.byteLength(emitted) < 1024*1024, 'Full300-input progress fits the unchanged Docker output bound');
  const projected = JSON.parse(emitted);
  assert.equal(projected.length, largeJobs.length);
  assert.equal(projected[1].input.parents.printingJobId, 'original');
  assert.equal(projected[2].input.referenceSource.referenceJobId, 'reference');
  assert.equal(emitted.includes('unusedNativeDetail'), false);
  assert.match(source, /timeout:count===100\?1200000:2700000,intervals:\[1000,5000,10000\]/, 'Original native deadlines remain');
});
