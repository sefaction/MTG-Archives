'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {TYPES, STATUSES, MARKER, validateIssue, feedback, run} = require('./issue-guidelines.cjs');

const body = `### Problem or intended outcome
Keep parent issue summaries current.
### Evidence and limitations
Audit at revision abc123 found stale summaries; no production acceptance claimed.
### Work already done
None yet.
### Remaining work and next action
Implement the validator, then test repeat events.
### Acceptance or completion criteria
Repeated events update one comment and preserve issue history.
`;
const issue = (changes = {}) => ({number: 42, state: 'open', labels: ['type: maintenance', 'status: backlog', 'area: infrastructure'], body, ...changes});

test('all supported work types and statuses, multi-area and independent flags', () => {
  for (const type of TYPES) for (const status of STATUSES) {
    assert.deepEqual(validateIssue(issue({labels: [`type: ${type}`, `status: ${status}`, {name: 'area: infrastructure'}, 'area: test infrastructure', 'in-progress', 'tracker', 'roadmap', 'deferred', 'codex']})), []);
  }
  assert.deepEqual(validateIssue(issue({labels: ['type: feature', 'status: backlog', 'area: new distinct domain']})), []);
});

test('absent, conflicting, unknown and legacy-only labels fail the correct dimension', () => {
  assert.equal(validateIssue(issue({labels: []})).length, 3);
  for (const labels of [
    ['type: bug', 'type: feature', 'status: backlog', 'area: review'],
    ['type: surprise', 'status: backlog', 'area: review'],
    ['type: bug', 'type:feature', 'status: backlog', 'area: review'],
    ['bug', 'enhancement', 'status: backlog', 'area: review'],
    ['type: bug', 'status: backlog', 'status: awaiting review', 'area: review'],
    ['type: bug', 'status: magic', 'area: review'],
    ['type: bug', 'in-progress', 'area: review'],
    ['type: bug', 'status: backlog', 'area: '],
  ]) assert.equal(validateIssue(issue({labels})).length, 1);
});

test('required summary categories are individually checked and not just headings', () => {
  for (const heading of ['Problem or intended outcome', 'Evidence and limitations', 'Work already done', 'Remaining work and next action', 'Acceptance or completion criteria']) {
    const missing = body.replace(new RegExp(`### ${heading}\\n[^\\n]*\\n`), '');
    assert.equal(validateIssue(issue({body: missing})).length, 1, heading);
  }
  assert.equal(validateIssue(issue({body: null})).length, 5);
  assert.equal(validateIssue(issue({body: body.replace(/\n[^#\n][^\n]*\n/g, '\n_No response_\n')})).length, 5);
});

test('legacy combined bold bullets, alternate headings, plain labels and history', () => {
  const legacy = `## Current queue summary - October 15, 2026
**Outcome/parent:** reliable review for #302.
- **Delivered/evidence:** #817 merged at abc123; bounded database controls pass, not independent accuracy.
- **Unique remaining/next:** map unanswered scenarios to evidence and test one missing case.
- **Completion:** every remaining scenario has evidence or linked disposition.
## Preserved scope and history
Old work pending review stays here as history.
`;
  assert.deepEqual(validateIssue(issue({body: legacy})), []);
  assert.deepEqual(validateIssue(issue({body: 'Problem: keep parent summaries current.\nEvidence: observed at abc123 with bounded scope.\nDelivered: none yet.\nNext: test the feedback lifecycle.\nDone when: all repeat events preserve history.'})), []);
});

test('prose current summaries are accepted without requiring exact headings', () => {
  assert.deepEqual(validateIssue(issue({body: `## Current scoped result
The problem is stale issue summaries. PR #783 delivered the policy; qualification evidence at abc123 is limited to the audited queue.
The remaining next action is to test repeat events. Completion requires one comment and unchanged history.
`})), []);
});

test('legacy investigation prose accepts bounded stopping rules and required repair invariants', () => {
  for (const completion of ['The repair must retain all original assertions and preserve every failure cause.', 'Compare the failure interval once, then stop and record attribution limits.', 'Stop after one terminal case or the run budget.']) {
    assert.deepEqual(validateIssue(issue({body: `The local worker naturally exited during an authorized build. The delivered repair is merged; evidence at abc123 remains limited. Next bounded investigation: observe one authorized recurrence. ${completion}`})), []);
  }
});

test('placeholder, quoted, code and hidden content cannot fill missing fields', () => {
  for (const hidden of [`<!-- ${body} -->`, '```markdown\n' + body + '```', '~~~markdown\n' + body + '~~~', body.split('\n').map(line => '> ' + line).join('\n')]) {
    assert.equal(validateIssue(issue({body: hidden})).length, 5);
  }
  assert.equal(validateIssue(issue({body: body.replace('None yet.', 'TBD')})).length, 1);
});

test('legacy scoped updates can inherit still-applicable acceptance criteria below preserved history', () => {
  assert.deepEqual(validateIssue(issue({body: '## Current scoped result\nPR #99 is merged. Next action: independent review of the remaining scope.\n## Preserved original scope\n' + body})), []);
});

test('closed issues and pull requests are excluded', () => {
  assert.deepEqual(validateIssue(issue({state: 'closed', body: '', labels: []})), []);
  assert.deepEqual(validateIssue(issue({pull_request: {}, body: '', labels: []})), []);
});

function harness(current = issue(), comments = []) {
  const calls = [];
  let live = current;
  const github = {rest: {issues: {
    get: async target => {calls.push(['get', target]); return {data: live};},
    listComments: Symbol('listComments'),
    createComment: async params => {calls.push(['create', params]); comments.push({id: 7, body: params.body, user: {login: 'github-actions[bot]', type: 'Bot'}});},
    updateComment: async params => {calls.push(['update', params]); comments.find(comment => comment.id === params.comment_id).body = params.body;},
  }}, paginate: async (method, params) => {assert.equal(method, github.rest.issues.listComments); assert.equal(params.per_page, 100); return comments;}};
  const args = {github, context: {repo: {owner: 'owner', repo: 'repo'}, payload: {issue: {number: 42, body: 'stale', labels: []}}}, core: {info: () => {}}};
  return {calls, comments, args, setLive: value => {live = value;}};
}

test('valid issues are silent; stale event body/labels are never used', async () => {
  const h = harness();
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind !== 'get').length, 0);
});

test('repeated invalid events, changed findings, correction, close and reopen reuse one comment', async () => {
  const h = harness(issue({labels: []}));
  await run(h.args);
  await run(h.args);
  assert.equal(h.comments.length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, 0);
  h.setLive(issue({labels: ['type: maintenance']}));
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, 1);
  h.setLive(issue());
  await run(h.args);
  assert.match(h.comments[0].body, /resolved/);
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, 2);
  h.setLive(issue({state: 'closed'}));
  await run(h.args);
  assert.match(h.comments[0].body, /inactive/);
  h.setLive(issue({labels: []}));
  await run(h.args);
  assert.match(h.comments[0].body, /Choose exactly one/);
  assert.equal(h.comments.length, 1);
});

test('human spoofed marker is ignored and untrusted text is never echoed', async () => {
  const payload = '${{ secrets.GITHUB_TOKEN }} $(touch /tmp/pwn) `process.exit()` @everyone <script>alert(1)</script>';
  const human = {id: 1, body: MARKER, user: {login: 'github-actions[bot]', type: 'User'}};
  const h = harness(issue({body: payload, labels: [payload]}), [human]);
  const before = structuredClone(h.args.context.payload);
  await run(h.args);
  assert.equal(h.comments.length, 2);
  assert.equal(human.body, MARKER);
  assert.equal(h.comments[1].body.includes(payload), false);
  assert.deepEqual(h.args.context.payload, before);
  assert.equal(feedback(validateIssue(issue({body: payload}))).includes(payload), false);
});

test('existing bot feedback beyond the first comment page is reused', async () => {
  const comments = Array.from({length: 105}, (_, index) => ({id: index + 1, body: 'Human discussion', user: {login: 'human', type: 'User'}}));
  comments.push({id: 999, body: feedback(['old finding']), user: {login: 'github-actions[bot]', type: 'Bot'}});
  const h = harness(issue(), comments);
  await run(h.args);
  assert.equal(h.comments.length, 106);
  assert.equal(h.calls.find(([kind]) => kind === 'update')[1].comment_id, 999);
  assert.match(h.comments[105].body, /resolved/);
});

test('API failures propagate for visible workflow failure; no guessed remediation', async () => {
  const h = harness(issue({labels: []}));
  h.args.github.rest.issues.createComment = async () => {throw new Error('permission denied');};
  await assert.rejects(run(h.args), /permission denied/);
  await assert.rejects(run({...h.args, context: {...h.args.context, payload: {issue: {number: '42;evil'}}}}), /Expected an issue event/);
});

test('forms and workflow wiring preserve the safety boundaries', () => {
  for (const type of TYPES) {
    const form = readFileSync(`${__dirname}/../ISSUE_TEMPLATE/${type}.yml`, 'utf8');
    assert.ok(form.includes(`labels: ['type: ${type}']`));
    for (const id of ['outcome', 'evidence', 'delivered', 'remaining', 'completion']) assert.ok(form.includes(`id: ${id}`));
    assert.equal((form.match(/required: true/g) ?? []).length, 5);
  }
  const workflow = readFileSync(`${__dirname}/../workflows/issue-guidelines.yml`, 'utf8');
  for (const event of ['opened', 'edited', 'reopened', 'labeled', 'unlabeled', 'transferred', 'closed']) assert.ok(workflow.includes(event));
  assert.ok(workflow.includes('cancel-in-progress: false'));
  assert.ok(workflow.includes('persist-credentials: false'));
  assert.ok(workflow.includes('permissions: {}'));
  assert.ok(workflow.includes('issues: write'));
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|github\.event\.issue\.(body|title)|run:/);
});
