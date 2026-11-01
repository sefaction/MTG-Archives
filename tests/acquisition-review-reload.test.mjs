// Host-only review regression. Executes complete functions extracted from actual TSX.
// Set REVIEW_SOURCE_ROOT to exercise a separately prepared corrected worktree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import vm from 'node:vm';
import ts from 'typescript';
const root = process.env.REVIEW_SOURCE_ROOT || path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'components/AcquisitionReviewControls.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let clearDraftCallback;
let lifecycleEffect;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && n.name && ['reload', 'submit'].includes(n.name.text)) functions.set(n.name.text, n.getText(tree));
  if (ts.isVariableDeclaration(n) && n.name.getText(tree) === 'clearDraft' && ts.isCallExpression(n.initializer))
    clearDraftCallback = n.initializer.arguments[0].getText(tree);
  if (ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect' &&
      n.arguments[0]?.getText(tree).includes('++requestVersion.current') &&
      n.arguments[1]?.getText(tree).replace(/\s/g, '') === '[userId,batchId,photoId]')
    lifecycleEffect = n.arguments[0].getText(tree);
  ts.forEachChild(n, visit);
}
visit(tree);
assert.equal(functions.size, 2, 'Actual complete reload and submit declarations required');
assert.ok(clearDraftCallback, 'Actual complete clearDraft callback required');
const compile = code => ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;

// Execute actual draft deletion logic too, including write-ID preservation.
const draftPath = path.join(root, 'lib/acquisition-browser-review-draft.ts');
const draftText = fs.readFileSync(draftPath, 'utf8');
const draftTree = ts.createSourceFile(draftPath, draftText, ts.ScriptTarget.Latest, true);
const deletion = draftTree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'clearAcquisitionDraft');
assert.ok(deletion);
const deleteCode = compile(deletion.getText(draftTree).replace(/^export\s+/, ''));
const uiCode = compile('const clearDraft = ' + clearDraftCallback + ';\n' + [...functions.values()].join('\n') +
  '\nconst lifecycleCleanup = ' + (lifecycleEffect ? '(' + lifecycleEffect + ')()' : 'undefined') + ';');

function harness() {
  const pending = [];
  const state = {busy: false, field: 'LP', record: {revision: 1, condition: 'NM'}, stored: {writeId: 'own', condition: 'LP'},
    error: 'earlier request failed', message: '', warnings: [], applied: [], dirty: true, refreshed: 0, callbacks: []};
  const requestVersion = {current: 0};
  const context = {
    state, requestVersion,
    endpoint: '/api/acquisition/batch/review', photoId: 'photo', userId: 'user', batchId: 'batch',
    draftWrite: {current: 'own'}, evidenceTokens: {current: {displayed: []}}, dirty: {current: true}, focusAfterReview: {current: false},
    record: state.record, selected: {id: 'printing', lang: 'en'}, finish: 'NONFOIL', condition: 'LP', language: 'en', openerPlayerId: null,
    call: (...args) => new Promise((resolve, reject) => pending.push({args, resolve, reject})),
    setObservedRevision: revision => {state.observed = revision},
    setDraftWarning: value => state.warnings.push(value),
    setError: value => {state.error = value}, setMessage: value => {state.message = value},
    setDraftDirty: value => {state.dirty = value}, onDirtyChange: (_id, value) => {state.dirty = value},
    setEditing: value => {state.editing = value}, refresh: () => {state.refreshed++}, onNextAwaiting: () => {},
    apply: value => {state.applied.push(value); state.field = value.condition; state.record = value; state.dirty = false},
    localStorage: {removeItem: () => {state.stored = null}},
    acquisitionDraftKey: () => 'bounded-photo-key', readAcquisitionDraft: () => state.stored, changed: () => {},
  };
  for (const name of ['setObservedRevision', 'setDraftWarning', 'setError', 'setMessage', 'setDraftDirty',
    'onDirtyChange', 'setEditing', 'refresh', 'onNextAwaiting', 'apply', 'changed']) {
    const callback = context[name];
    context[name] = (...args) => {state.callbacks.push(name); return callback(...args)};
  }
  // Lexical busy/regionEditing behave like the values captured by one render;
  // setter records UI exclusion without mutating that render's captured busy.
  const api = vm.runInNewContext(deleteCode + '\nlet busy = false, regionEditing = false;\n' +
    'const setBusy = value => { state.callbacks.push("setBusy"); state.busy = value; };\n' + uiCode +
    '\n({reload,submit,lifecycleCleanup,setCapturedBusy:v=>busy=v,setRegionEditing:v=>regionEditing=v})', context);
  return {api, state, pending, requestVersion, context};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('explicit reload prevents new editor input while its response is pending', async () => {
  const h = harness(), work = h.api.reload();
  assert.equal(h.pending.length, 1);
  const excluded = h.state.busy;
  // Simulate a normal input only if the rendered editor is still enabled.
  if (!excluded) {h.state.field = 'DMG'; h.state.stored = {writeId: 'new-own', condition: 'DMG'}; h.context.draftWrite.current = 'new-own';}
  h.pending[0].resolve({revision: 2, condition: 'NM'}); await work;
  assert.equal(excluded, true, 'Reload must not leave the editor enabled then erase its newer draft');
  assert.equal(h.state.busy, false);
});
test('superseded reload success cannot clear or apply a newer draft', async () => {
  const h = harness(), work = h.api.reload();
  h.requestVersion.current++;
  h.state.field = 'DMG'; h.state.stored = {writeId: 'new-own', condition: 'DMG'}; h.context.draftWrite.current = 'new-own';
  h.pending[0].resolve({revision: 2, condition: 'NM'}); await work;
  assert.equal(h.state.field, 'DMG'); assert.equal(h.state.stored.condition, 'DMG'); assert.equal(h.state.applied.length, 0);
});
test('superseded reload failure cannot replace a newer action message', async () => {
  const h = harness(), work = h.api.reload(); h.requestVersion.current++; h.state.error = 'newer failure';
  h.pending[0].reject(new Error('obsolete failure')); await work;
  assert.equal(h.state.error, 'newer failure');
});
for (const gate of ['busy', 'region']) test('explicit reload respects active ' + gate + ' operation', async () => {
  const h = harness();
  if (gate === 'busy') h.api.setCapturedBusy(true); else h.api.setRegionEditing(true);
  const work = h.api.reload(); const calls = h.pending.length;
  if (calls) h.pending[0].resolve({revision: 2, condition: 'NM'});
  await work; assert.equal(calls, 0); assert.equal(h.state.stored.condition, 'LP');
});
test('successful explicit reload still discards its original draft and loads current review', async () => {
  const h = harness(), work = h.api.reload(); h.pending[0].resolve({revision: 2, condition: 'NM'}); await work;
  assert.equal(h.state.field, 'NM'); assert.equal(h.state.stored, null); assert.equal(h.state.observed, 2);
});
test('failed explicit reload retains draft and permits a later retry', async () => {
  const h = harness(), work = h.api.reload(); h.pending[0].reject(new Error('offline')); await work;
  assert.equal(h.state.field, 'LP'); assert.equal(h.state.stored.condition, 'LP'); assert.equal(h.state.error, 'offline'); assert.equal(h.state.busy, false);
});
test('reload cannot delete a newer other-tab draft', async () => {
  const h = harness(), work = h.api.reload(); h.state.stored = {writeId: 'other-tab', condition: 'DMG'};
  h.pending[0].resolve({revision: 2, condition: 'NM'}); await work;
  assert.equal(h.state.stored.writeId, 'other-tab'); assert.ok(h.state.warnings.some(x => /newer draft/.test(x)));
});
test('acknowledged submit still reloads despite its own active busy state', async () => {
  const h = harness(), work = h.api.submit('accept');
  assert.equal(h.state.busy, true); assert.equal(h.pending[0].args[1].action, 'accept');
  h.api.setCapturedBusy(true); // The post-save read must work even when its caller owns busy.
  h.pending[0].resolve({revision: 2}); await tick();
  assert.equal(h.pending.length, 2, 'Do not fix explicit reload by skipping submit post-save refresh');
  assert.equal(h.pending[1].args[0], '/api/acquisition/batch/review?photoId=photo');
  assert.equal(h.state.busy, true, 'Submit must keep the editor excluded during its post-save read');
  h.pending[1].resolve({revision: 2, condition: 'LP'}); await work;
  assert.equal(h.state.observed, 2); assert.equal(h.state.field, 'LP'); assert.equal(h.state.stored, null);
  assert.equal(h.state.busy, false); assert.equal(h.state.refreshed, 1);
});

for (const outcome of ['success', 'failure']) test('unmounted reload ' + outcome + ' leaves remounted draft and callbacks alone', async () => {
  const h = harness();
  // An instance without a write ID cannot rely on clearDraft's write-ID comparison.
  h.context.draftWrite.current = undefined;
  const work = h.api.reload();
  assert.equal(typeof h.api.lifecycleCleanup, 'function', 'Actual lifecycle invalidation effect required');
  h.api.lifecycleCleanup();
  h.state.stored = {writeId: 'remounted-editor', condition: 'DMG'};
  const before = JSON.stringify(h.state);
  if (outcome === 'success') h.pending[0].resolve({revision: 2, condition: 'NM'});
  else h.pending[0].reject(new Error('obsolete unmounted request'));
  await work;
  assert.equal(JSON.stringify(h.state), before, 'A settled old request must not mutate storage or invoke state callbacks');
});
