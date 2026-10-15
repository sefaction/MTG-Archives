# Issue workflow safeguards

[AGENTS.md](../AGENTS.md#github-issue-organization-and-upkeep) is the canonical policy. The five issue forms apply only their chosen type label and require outcome, evidence/limitations, delivered work, next action and completion criteria. A maintainer still selects exactly one supported status and at least one area; the form explains that field text cannot apply labels. No default workflow status is guessed. Blank UI issues are disabled; API/CLI-created issues remain supported and subject to the same check.

## Advisory event check

On open, edit, reopen, label, unlabel, transfer or close, the default-branch workflow re-reads the issue via GitHub's API. Per-issue concurrency serializes executions with cancellation disabled; queued events use live state rather than stale payload bodies. It validates exactly one recognized type/status and at least one nonempty `area: ` label, allowing distinct future areas and unrelated labels/claims. Closed issues and PRs are exempt. The job has only `contents: read` and `issues: write`; checkout does not persist credentials. No repository settings or access changes are required.

The summary check recognizes headings, combined bold bullets, plain labels and equivalent prose. Original criteria retained beneath scoped updates remain valid structural evidence, so legacy issues need no destructive migration. Comments, quoted examples and fenced code are excluded. Empty/placeholder fields are rejected. This is a heuristic presence check: it cannot prove freshness, correctness, revision/denominator completeness, evidence quality, bounded investigation sufficiency or acceptance. Preserved historical text can satisfy structure; human review must reconcile the current summary. Do not treat a clean result as qualification.

An explicit sentence-inline `Completion:` label can also supply criteria after a long scope sentence, including in preserved history. Its first sentence must contain content beyond punctuation, common placeholders or a bare non-acceptance disclaimer; later unrelated discussion cannot fill an empty first sentence. This bounded rule does not attempt general natural-language interpretation. Existing headings, prose cues and comment lifecycle remain unchanged.

Only missing requirements create a comment. Subsequent events update the same marked `github-actions[bot]` comment when findings change; identical findings are silent. Correction marks it resolved, closure marks it inactive, and reopening reuses it. Human comments bearing the marker are ignored. No bodies, labels, assignments, claims, issue states or user comments are changed. Feedback contains only fixed text and never quotes issue-controlled content. The trusted default-branch module handles issue text as data; no issue text is interpolated into a shell, script, checkout ref or expression.

API errors fail the action visibly rather than silently claiming compliance. Deleted/locked/transferred issues can cause a failed API request; retry after resolving access/availability. Bot comments remain a best-effort advisory, not a required issue gate. GitHub may coalesce pending events; every execution checks current state, so intermediate transitions need not each get a comment. A manual duplicate workflow outside this concurrency group is unsupported.

## Rollout and review

The issue-event workflow becomes active only after an individually approved merge to the default branch. Existing issues are checked on their next supported event; this PR neither bulk-edits issues nor backfills comments. UI forms also use the default branch. Human/PAT/API-created issue events use the same validator. GitHub suppresses most follow-up workflow events caused by `GITHUB_TOKEN`; automation using that token must call `validateIssue` itself or leave a maintainer follow-up. No new credential or repository-wide token scope is introduced to bypass that restriction.

Events alone cannot refresh parent summaries after merges. The [PR template](pull_request_template.md) and AGENTS.md require the merger to identify affected parents, re-read current issues/comments, prepend/update current summaries with merged revisions and evidence limits, preserve dated history, reconcile remaining/deferred scope, and read back metadata. Close only completed scope or a visible acceptance-bearing transfer. A partial merge leaves a parent open; merge, deployment and independent user acceptance remain separate.

The check's issue-write permission is used solely for its own advisory comment. It grants no agent authority to merge, deploy, operate scanners or claim acceptance. Roll back by reverting the workflow/forms/module in an approved PR; existing feedback comments are retained as history. To check locally without GitHub writes:

```sh
node --test .github/scripts/issue-guidelines.test.cjs
```

Core verification runs this command on every PR. Tests cover canonical/conflicting labels, legacy summaries, empty fields, untrusted text, live-state readback and repeated/create/update/resolve/close/reopen feedback. Mocked API lifecycle tests do not prove a deployed issue-event run; a maintainer can observe the first normal issue event after merge without creating a disposable public issue.
