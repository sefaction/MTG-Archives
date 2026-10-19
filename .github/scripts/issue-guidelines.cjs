'use strict';

// Issue text is data only. Never execute it or include it in generated feedback.
const TYPES = ['bug', 'feature', 'improvement', 'maintenance', 'validation'];
const STATUSES = ['backlog', 'in progress', 'investigating', 'awaiting review', 'awaiting validation', 'needs decision'];
const MARKER = '<!-- mtg-archives:issue-guidelines:v1 -->';
const INTERNAL_LABEL = 'triage: complete';

function visibleText(body) {
  return String(body ?? '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|$(?![\s\S]))/gm, '')
    .split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join('\n');
}

function sections(body) {
  const text = visibleText(body);
  // Older issues prepend scoped updates and retain their original criteria below.
  // Check structure across the body; freshness is deliberately a human review gate.
  const current = text;
  const found = new Set();
  const patterns = {
    outcome: /\b(problem|intended outcome|outcome|purpose|request|parent\/user report|current (?:summary|scoped result|author investigation|scoped author evidence|merged delivery)|author qualification)\b/i,
    evidence: /\b(evidence|qualification|validation results|current bounded repair|observed|reproduction|reproduced|reproducible|user.report|Brian reports)\b/i,
    delivered: /\b(work (?:already )?done|delivered|completed work|implemented|merged|repairs|repaired|no implementation|planning only|not (?:yet )?started|none yet)\b/i,
    remaining: /\b(remaining|next(?: action| change| step| bounded (?:test|evidence|investigation))?|work left)\b/i,
    completion: /\b(acceptance|completion|complete when|done when|stopping criteri(?:a|on))\b/i,
  };
  // Support Markdown headings, bold summary bullets and plain labelled lines.
  const fields = [...current.matchAll(/^(?:#{1,6}\s+([^\n]+)|\s*(?:[-*]\s+)?\*\*([^\n]+?)\*\*\s*(.*)|\s*([A-Za-z][^:\n]{0,100}):\s*(.*))$/gm)];
  for (const field of fields) {
    const label = field[1] ?? field[2] ?? field[4];
    const inline = field[3] ?? field[5];
    const start = field.index + field[0].length;
    const next = fields.find(candidate => candidate.index >= start);
    const content = [inline, current.slice(start, next?.index ?? current.length)].filter(Boolean).join('\n').trim();
    if (!content || /^(?:_?No response_?|n\/?a|tbd|todo|\.{3})[.!]?$/i.test(content)) continue;
    for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(label)) found.add(key);
  }
  // Older current summaries use prose rather than a prescribed heading vocabulary.
  // Accept clear prose cues as well as inherited criteria in preserved scope.
  const prose = current.split(/\r?\n/).filter(line => !/^(?:\s*#|\s*(?:[-*]\s+)?\*\*)/.test(line))
    .map(line => line.replace(/^\s*[A-Za-z][^:\n]{0,100}:\s*/, '')).join('\n');
  const prosePatterns = {
    ...patterns,
    outcome: /\b(?:problem|outcome|purpose|request|impact|expected|broken|skips|loses|naturally exited)\b/i,
    completion: /\b(?:completion (?:requires|means)|acceptance criteria|complete when|done when|stopping criteri(?:a|on)|repair must|stop after|then stop)\b/i,
  };
  for (const [key, pattern] of Object.entries(prosePatterns)) {
    if (pattern.test(prose) && prose.trim().length > 80) found.add(key);
  }
  // A retained criterion can follow a long scope sentence on the same line (#822).
  // Inspect only its first sentence, so placeholders cannot borrow later discussion.
  const inlineProse = current.replace(/(`+)[\s\S]*?\1/g, '');
  for (const field of inlineProse.matchAll(/[.!?][ \t]+completion[ \t]*:[ \t]*([^\r\n]*)/gi)) {
    const criterion = field[1].split(/(?<=[.!?])[ \t]+/)[0].trim();
    if (!/[\p{L}\p{N}]/u.test(criterion) || /^(?:_?No response_?|n\/?a|tbd|todo|none(?: yet)?|pending)[.!]?$/i.test(criterion)) continue;
    if (/^(?:no (?:independent |production |user )?acceptance (?:is )?claimed|(?:independent|production|user) acceptance is not claimed|not (?:yet )?(?:accepted|complete|qualified))[.!]?$/i.test(criterion)) continue;
    found.add('completion');
  }
  return found;
}

function labelNames(issue) {
  return (issue.labels ?? []).map(label => typeof label === 'string' ? label : label.name);
}

function requiresInternalChecks(issue) {
  // Readiness opt-in, not origin: sorting/assignment labels do not complete triage.
  return labelNames(issue).includes(INTERNAL_LABEL);
}

function validateIssue(issue) {
  if (issue.state !== 'open' || issue.pull_request || !requiresInternalChecks(issue)) return [];
  const labels = labelNames(issue);
  const findings = [];
  for (const [prefix, allowed, description] of [['type: ', TYPES, 'work type'], ['status: ', STATUSES, 'workflow status']]) {
    const selected = labels.filter(label => typeof label === 'string' && label.startsWith(prefix.trimEnd()));
    if (selected.length !== 1 || !allowed.some(value => selected[0] === prefix + value)) {
      findings.push(`Choose exactly one supported ${description} label (see AGENTS.md).`);
    }
  }
  if (!labels.some(label => typeof label === 'string' && /^area: \S/.test(label))) findings.push('Add at least one area label.');
  const found = sections(issue.body);
  for (const [key, description] of Object.entries({outcome: 'problem or intended outcome', evidence: 'evidence and limitations', delivered: 'work already done (or explicitly none)', remaining: 'remaining work and exact next action', completion: 'acceptance/completion criteria'})) {
    if (!found.has(key)) findings.push(`Add current-summary content for ${description}.`);
  }
  return findings;
}

function feedback(findings) {
  if (!findings.length) return `${MARKER}\nIssue guideline findings resolved. Structural checks pass; freshness, evidence quality and acceptance still need human review.`;
  return `${MARKER}\nMaintainers and agents: please complete the [internal tracking details](https://github.com/sefaction/MTG-Archives/blob/main/AGENTS.md#github-issue-organization-and-upkeep) for this issue. The reporter does not need to fill out this checklist.\n\n${findings.map(finding => `- ${finding}`).join('\n')}\n\nPreserve the original report and history. Equivalent headings and summary bullets are supported; no status, body or acceptance is assigned by this check. This comment updates after issue edits or label changes.`;
}

async function run({github, context, core}) {
  const {owner, repo} = context.repo;
  const issue_number = context.payload.issue?.number;
  if (!Number.isSafeInteger(issue_number) || issue_number <= 0) throw new Error('Expected an issue event.');
  const target = {owner, repo, issue_number};
  // Event payloads may already be stale after adjacent edits/label events.
  const {data: issue} = await github.rest.issues.get(target);
  if (issue.pull_request) return;
  const findings = validateIssue(issue);
  const comments = await github.paginate(github.rest.issues.listComments, {...target, per_page: 100});
  const existing = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.user?.type === 'Bot' && comment.body?.startsWith(MARKER));
  const internal = requiresInternalChecks(issue);
  const body = issue.state === 'closed' ? `${MARKER}\nIssue closed; guideline feedback is inactive. Closure and acceptance remain subject to the issue policy.`
    : !internal ? `${MARKER}\nNo additional fields are required from the reporter. Maintainers handle internal tracking details during triage.`
    : feedback(findings);
  if (existing && existing.body !== body) await github.rest.issues.updateComment({owner, repo, comment_id: existing.id, body});
  else if (!existing && findings.length) await github.rest.issues.createComment({...target, body});
  core.info(internal ? `Issue guidelines: ${findings.length} structural finding(s).` : 'Public report: internal tracking checks deferred to maintainer triage.');
}

module.exports = {TYPES, STATUSES, MARKER, INTERNAL_LABEL, sections, requiresInternalChecks, validateIssue, feedback, run};
