# Preserve review-fixture recovery after file cleanup failure

Related to existing [#692](https://github.com/sefaction/MTG-Archives/issues/692)
and release tracker [#310](https://github.com/sefaction/MTG-Archives/issues/310).

The capacity handoff, correction-discard focus and save-focus fixtures previously
deleted their photo/session/user graph before removing original and preview
files. A failed unlink therefore lost retry references and skipped later files.
Their outer cleanup also tested the truthiness of the workflow failure, losing
valid falsy thrown values when cleanup failed too.

These three fixtures now use the existing owned-file helper before the original
relational cleanup. The helper validates the complete identity set and absolute
root, attempts all independent paths in stable order, ignores only ENOENT, and
retains ordered failure causes. An incomplete file phase leaves recovery rows
intact. A separate presence flag retains every original workflow throw. Existing
cancellation/live-job guards, correction cleanup, browser handling, assertions,
deadlines and relational deletion order remain.

The existing source extractor and real filesystem/PostgreSQL verifier now expose
a separate three-fixture group. Acquisition integrity runs that group alongside
the unchanged 25 original-audit phases. This does not take PR #975's separately
owned outer workflow-error scope or the pending language correction in #958.

## Evidence and boundaries

- Base main `2ed6e3772432f8e3f92e4571f3b7589fb03cd2af`: the actual-source negative
  produces **27 failures / 158 passes**. Failures cover lost recovery rows,
  skipped independent files, premature deletion with invalid input, and falsy
  workflow causes. Corrected focused controls: **185 pass**, no skips.
- Full local types pass. Full Windows unit suite: **1,968 executions / 1,962
  passes / zero failures / six existing platform skips**. Dependencies and Prisma
  schema are unchanged; the owned dependency directory is reused read-only.
- Inverting only the declared imports, file-phase move and failure-presence flag
  reproduces every other normalized source byte in all three fixtures. All
  **117 original expect calls, 69 template literals and three deadlines** remain.
  The first rewrite guard correctly rejected an ambiguous earlier setup-file
  match before changing any fixture; the targeted edit then qualified.
- Exact test tree `71a4ec34930a3f9636a4f5dbe54d2feff254dfe6` was exported as
  1,686 source files. Current libraries, scripts, tests and Prisma sources were
  mounted read-only into a retained dependency image; no application build or
  shared dependency mutation was needed for this test-only change.
- Actual PostgreSQL 16 with all **95 migrations / 85 public tables** passes all
  three source-extracted cleanup cases. Each uses two owned photos and a
  populated peer. A real directory obstruction refuses one original unlink;
  all other independent paths are attempted, every recovery row survives,
  original bytes are verified before retry, replay is effect-free, and peer
  rows/files remain exact. Each full 85-table baseline pair matches.
- Existing cancellation prefixes may refresh only the exact owned session's
  `updatedAt` before the first unlink. The verifier separately checks every
  session and freezes all table fingerprints at that boundary; it does not
  globally ignore a field. The zero-client check and clean PostgreSQL exit pass.
- Both Node controllers and the owned temporary PostgreSQL container are
  retired; no owned network or persistent volume was created. The exact runtime
  claim is released. Four pre-existing review services retain their observed
  identities, states, storage and port configuration. Local Docker was started
  for this check; those services were observed stopped and were not restarted.

The small actual-source adapters qualify exception and file ordering, and the
disposable SQL/filesystem cases qualify recovery and conservation. They do not
rerun the complete desktop/phone review workflows, native/optical processing,
physical hardware, historical incidents, scale or installation acceptance.
Required current-head hosted checks and independent review are separate from
this local evidence. No application, dependency, schema, production, Inventory
policy or merge change is included. Keep broad #692/#310 open for their remaining
criteria; this is a bounded repair within their existing scope, with no new issue.
