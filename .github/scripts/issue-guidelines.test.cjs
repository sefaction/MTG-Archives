'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, readdirSync} = require('node:fs');
const yaml = require('js-yaml');
const {TYPES, STATUSES, MARKER, INTERNAL_LABEL, sections, requiresInternalChecks, validateIssue, feedback, run} = require('./issue-guidelines.cjs');

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
// Existing regression cases exercise internal tracking even when dimensions are absent.
const issue = (changes = {}) => ({number: 42, state: 'open', body, ...changes, labels: [INTERNAL_LABEL, ...(changes.labels ?? ['type: maintenance', 'status: backlog', 'area: infrastructure'])]});
const publicIssue = (changes = {}) => ({number: 42, state: 'open', title: 'Cannot move cards', body: 'My cards will not move to another box.', labels: [], user: {login: 'reader', type: 'User'}, ...changes});

// Verbatim retained scope paragraph from issue #822; the label occurs mid-paragraph.
const inlineCompletionParagraph = 'Implement and qualify the narrow preparation path with actual-function real-file controls, existing correction-file and database compatibility, required exact-head CI and cumulative local review. Completion: close failure cannot bypass unlink; a failed unlink remains explicit; every cause and the primary retry code survive; successful immutable publication and source/neighbor conservation remain intact. Separate reviewer owns readiness, individual approval, merge and closure.';
const noCompletion = body.replace(/### Acceptance or completion criteria\n[^\n]*\n/, '');
const longPrefix = 'The next bounded step retains the existing source identities, failure records, cleanup ownership, exact-head checks and independent review requirements. ';

test('issue #822 exact inherited paragraph satisfies completion without rewriting its body', () => {
  const original = noCompletion + '\n## Preserved initial problem and evidence\n' + inlineCompletionParagraph;
  const sample = issue({body: original});
  assert.deepEqual(validateIssue(sample), []);
  assert.equal(sample.body, original);
  assert.equal(sections(inlineCompletionParagraph).has('completion'), true);
});

test('sentence-inline completion supports long prefixes, case, tabs and substantive criteria', () => {
  for (const label of ['Completion:', 'completion:', 'COMPLETION :\t']) {
    const paragraph = longPrefix + label + ' The corrected cleanup attempts unlink and preserves each failure.';
    assert.deepEqual(validateIssue(issue({body: noCompletion + '\n' + paragraph})), []);
  }
});

test('inline completion rejects empty values and placeholder first sentences', () => {
  for (const value of ['', ' ', '.', '!', '…', '---', 'TBD', 'TODO.', '_No response_', 'N/A', 'None yet.', 'Pending', '...', 'TBD. Separate reviewer owns readiness and approval.', '\nUnrelated trailing discussion does not provide criteria.']) {
    const sample = noCompletion + '\n' + longPrefix + 'Completion: ' + value;
    assert.deepEqual(validateIssue(issue({body: sample})), ['Add current-summary content for acceptance/completion criteria.'], value);
  }
});

test('acceptance disclaimers alone do not become inline completion criteria', () => {
  for (const disclaimer of ['No production acceptance is claimed.', 'Independent acceptance is not claimed.', 'Completion is not claimed.', 'Completion: No independent acceptance claimed.', 'Completion: No production acceptance is claimed.', 'Completion: Independent acceptance is not claimed.', 'Completion: Not yet accepted.', 'Completion: Not complete.']) {
    assert.equal(sections(longPrefix + disclaimer).has('completion'), false, disclaimer);
  }
});

test('hidden, quoted and code examples cannot supply inline completion criteria', () => {
  for (const hidden of ['<!-- ' + inlineCompletionParagraph + ' -->', '> ' + inlineCompletionParagraph, '```markdown\n' + inlineCompletionParagraph + '\n```', '~~~markdown\n' + inlineCompletionParagraph + '\n~~~', longPrefix + '`Completion: unlink must preserve source data.`', '`' + inlineCompletionParagraph + '`', '`Code example\n' + inlineCompletionParagraph + '\n`']) {
    assert.deepEqual(validateIssue(issue({body: noCompletion + '\n' + hidden})), ['Add current-summary content for acceptance/completion criteria.']);
  }
});

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

test('minimal UI/API reports stay outside internal checks, including shared owner identity', () => {
  for (const user of [{login: 'reader', type: 'User'}, {login: 'sefaction', type: 'User'}, {login: 'integration[bot]', type: 'Bot'}, undefined]) {
    for (const labels of [[], ['type: bug'], ['area: inventory'], ['question', 'codex-looking-text'], ['codex'], ['status: backlog'], ['triage:complete'], ['triage: complete '], ['type: bug', 'status: in progress', 'area: inventory', 'codex', 'tracker', 'roadmap']]) {
      const report = publicIssue({user, labels});
      assert.equal(requiresInternalChecks(report), false);
      assert.deepEqual(validateIssue(report), []);
    }
  }
});

test('sorting and assignment are not triage; only explicit readiness activates internal checks', () => {
  for (const label of ['codex', 'in-progress', 'tracker', 'roadmap', 'status: backlog', 'status:unknown']) {
    const report = publicIssue({labels: [{name: label}]});
    assert.equal(requiresInternalChecks(report), false, label);
    assert.deepEqual(validateIssue(report), [], label);
  }
  const ready = publicIssue({labels: [{name: INTERNAL_LABEL}]});
  assert.equal(requiresInternalChecks(ready), true);
  assert.equal(validateIssue(ready).length, 8);
  assert.equal(requiresInternalChecks(publicIssue({body: '<!-- origin: ChatGPT; codex; status: backlog; triage: complete -->\nI am an agent. ' + body})), false);
  assert.equal(requiresInternalChecks(publicIssue({author_association: 'OWNER'})), false);
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

test('new public reports are silent across repeated events, including misleading payload labels', async () => {
  const h = harness(publicIssue());
  h.args.context.payload.issue.labels = [INTERNAL_LABEL, 'codex', 'status: backlog'];
  await run(h.args);
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'create' || kind === 'update').length, 0);
});

test('triage opt-in, correction, return to intake and reopen reuse one feedback comment', async () => {
  const report = publicIssue();
  const original = structuredClone(report);
  const h = harness(report);
  await run(h.args);
  h.setLive(publicIssue({labels: [INTERNAL_LABEL, 'status: backlog']}));
  await run(h.args);
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].body, /Maintainers and agents:/);
  assert.match(h.comments[0].body, /reporter does not need/);
  h.setLive(issue());
  await run(h.args);
  assert.match(h.comments[0].body, /resolved/);
  h.setLive(publicIssue({labels: ['codex', 'status: backlog', 'type: bug', 'area: inventory']}));
  await run(h.args);
  assert.match(h.comments[0].body, /No additional fields/);
  const updates = h.calls.filter(([kind]) => kind === 'update').length;
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, updates);
  h.setLive(publicIssue({state: 'closed'}));
  await run(h.args);
  assert.match(h.comments[0].body, /inactive/);
  h.setLive(publicIssue());
  await run(h.args);
  assert.match(h.comments[0].body, /No additional fields/);
  assert.equal(h.comments.length, 1);
  assert.deepEqual(report, original);
});

test('legacy public warnings are retired once; a human marker remains untouched', async () => {
  const human = {id: 10, body: MARKER, user: {login: 'reader', type: 'User'}};
  const h = harness(publicIssue(), [human, {id: 11, body: feedback(['Old internal finding']), user: {login: 'github-actions[bot]', type: 'Bot'}}]);
  await run(h.args);
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 0);
  assert.equal(human.body, MARKER);
  assert.match(h.comments[1].body, /No additional fields/);
});

test('recognizing inherited inline completion resolves the old warning once without body edits', async () => {
  const current = issue({body: noCompletion + '\n## Preserved initial problem and evidence\n' + inlineCompletionParagraph});
  const original = current.body;
  const h = harness(current, [{id: 17, body: feedback(['Add current-summary content for acceptance/completion criteria.']), user: {login: 'github-actions[bot]', type: 'Bot'}}]);
  await run(h.args);
  await run(h.args);
  assert.equal(h.calls.filter(([kind]) => kind === 'update').length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 0);
  assert.match(h.comments[0].body, /resolved/);
  assert.equal(current.body, original);
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
  const workflow = readFileSync(`${__dirname}/../workflows/issue-guidelines.yml`, 'utf8');
  for (const event of ['opened', 'edited', 'reopened', 'labeled', 'unlabeled', 'transferred', 'closed']) assert.ok(workflow.includes(event));
  assert.ok(workflow.includes('cancel-in-progress: false'));
  assert.ok(workflow.includes('persist-credentials: false'));
  assert.ok(workflow.includes('permissions: {}'));
  assert.ok(workflow.includes('issues: write'));
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|github\.event\.issue\.(body|title)|run:/);
  const parsed = yaml.load(workflow);
  assert.deepEqual(parsed.permissions, {});
  assert.deepEqual(parsed.jobs.check.permissions, {contents: 'read', issues: 'write'});
  assert.deepEqual(Object.keys(parsed.on), ['issues']);
});

test('public form YAML has one required description, optional details and a general fallback', async () => {
  const folder = `${__dirname}/../ISSUE_TEMPLATE`;
  assert.deepEqual(readdirSync(folder).sort(), ['bug.yml', 'config.yml', 'feature.yml', 'general.yml']);
  const config = yaml.load(readFileSync(`${folder}/config.yml`, 'utf8'));
  assert.equal(config.blank_issues_enabled, false);
  assert.equal(config.contact_links, undefined);
  const names = new Set();
  for (const file of ['bug.yml', 'feature.yml', 'general.yml']) {
    const form = yaml.load(readFileSync(`${folder}/${file}`, 'utf8'));
    assert.equal(typeof form.name, 'string');
    assert.equal(typeof form.description, 'string');
    assert.deepEqual(Object.keys(form).sort(), ['body', 'description', 'name']);
    assert.ok(!names.has(form.name));
    names.add(form.name);
    // GitHub supplies the title; a form title key only supplies a default value.
    assert.equal(form.title, undefined);
    assert.equal(form.labels, undefined);
    assert.equal(form.assignees, undefined);
    const fields = form.body.filter(field => field.type !== 'markdown');
    assert.equal(fields.length, 2);
    assert.equal(new Set(fields.map(field => field.id)).size, fields.length);
    assert.deepEqual(fields.map(field => field.type), ['textarea', 'textarea']);
    assert.deepEqual(fields.map(field => field.validations.required), [true, false]);
    assert.deepEqual(fields.map(field => field.id), ['description', 'details']);
    for (const field of fields) {
      assert.match(field.id, /^[A-Za-z0-9_-]+$/);
      assert.equal(typeof field.attributes.label, 'string');
      assert.equal(field.attributes.value, undefined);
      assert.equal(field.attributes.render, undefined); // Preserve Markdown and screenshot attachments.
      assert.equal(field.validations.min_length, undefined);
      assert.doesNotMatch(JSON.stringify(field), /taxonomy|roadmap|acceptance|remaining work|work already done|status:/i);
    }
    // Simulate GitHub's submitted Markdown; explanatory markdown elements aren't submitted.
    for (const details of ['', '_No response_']) {
      const rendered = `### ${fields[0].attributes.label}\n\nMy cards will not move.\n\n### ${fields[1].attributes.label}\n\n${details}`;
      const h = harness(publicIssue({body: rendered}));
      assert.deepEqual(validateIssue(publicIssue({body: rendered})), []);
      await run(h.args);
      assert.equal(h.calls.filter(([kind]) => kind === 'create' || kind === 'update').length, 0);
    }
  }
  assert.deepEqual([...names].sort(), ['Report a problem', 'Something else', 'Suggest an idea']);
});
