# Bulk-review proposal attribution

Issue #683, following the recognition/correction feedback audit under #463 and
Scan cards review audit #506.

## Problem and behavior

Bulk review loaded a server-signed proposal token but omitted it from its review
save. An ordinary agreement therefore became `DISPLAY_IDENTITY_UNKNOWN`, which
also retained an extra original in the correction library. Individual review
already supplied proposal identities through the same save API.

Bulk confirmation now supplies the exact loaded row's token as `current` and its
single displayed identity. Reloading proposals replaces that row's token together
with its proposal and revision. The existing explicit-choice fence still requires
fresh approval when a previously approved printing changes. No initial/edit
history is manufactured, and tokens are not fetched again during confirmation.

Missing tokens still save ordinary reviews through the existing API and retain
the conservative unknown-display/original-preservation behavior. Owner, actor,
original digest/generation, candidate, revision, signature and saved-job checks
remain server-side. Prospective control sampling, existing labels, verification
state, retention and explicit Inventory confirmation remain unchanged. Old events
are not backfilled. This is feedback attribution, not an accuracy improvement.

## Baseline and qualification

The unchanged qualified main app (`9dc0e2a`) reproduced the bug in a disposable
authenticated browser fixture. Three real uploads and review saves used controlled
proposal presentations signed by the actual server for their real owner/photos/
candidates/jobs. Two proposals had valid tokens, one deliberately had no token,
and one valid-token photo was prospectively sampled. After explicitly approving
a reloaded changed printing, all three saved events were unknown and all three
photos had retained memberships. Reviews=3, Inventory=0, commits=0. The corrected
baseline fails exactly at the expected first-choice agreement assertion and
cleans up its records/files.

The first fixture attempt did not establish an explicit checkbox choice before
checking the existing reload fence; it failed that unrelated expectation. The
second observed the real attribution failure but hung in route teardown after
suppressing a polling reply. Its exact owned residue was independently inspected
and removed; the fixture now aborts closing replies, closes its owned test page
and guarantees database/file cleanup. Failed logs and traces remain private.

Final-image desktop/320px tests must verify current proposal identity after reload,
per-photo token isolation, known first-choice classification, missing-token
conservatism, sampled-original retention, unverified labels, zero Inventory writes,
rendered images, no overflow/errors and owned cleanup. Existing incremental bulk
preview, draft protection, individual correction/copy and Inventory handoff tests
remain regression gates. Core types/tests/build, cumulative Docker source/runtime,
original data/SHA and service conservation qualification is in progress.

## Final local qualification — October 8, 2026

Core verification passed: all858 unit tests, zero failures/skips, type checking,
production build and13 client manifests. Final fixture types also pass. Only
the bulk save request changes application behavior; the server/native libraries,
schema, worker logic and recognition policy are unchanged.

The required-installer Docker web build passed in188.181seconds from cumulative
`b1a1bf3e934fdfb83a35f3b2e1a06bfa7915fcd8`. Running web image
`sha256:2f2112d74d3b5d3ed57cccc7bc95006725674c169a68302ae47a32d9dc9b6a79`
matches594 application inputs with digest
`975cab1bf3451693cb90a0dfcb15068ba28a33858ccf1f1b2da9bef99d27c1c7`.
All308 shared inputs match each unchanged native worker. Only web was recreated;
the other12 services retained their images, lifecycles, mounts and limits. All13
ordinary services are running with a healthy app and acquisition workers running.

The two new browser cases pass at1366/320px. Both record the reloaded current
printing as a first-choice agreement, keep the missing-token event unknown and
preserve the prospective control. Memberships=2, reviews=3, Inventory=0, commits=0
per case; the unsampled signed agreement has no extra retained example. Labels
remain unverified. Actual original/proposal images render, no overflow/page errors
occur, and all four screenshots were inspected.

Seven distinct affected browser workflows qualify across runs. The initial group
passed6/7, including both new cases,32-photo preview,14-photo draft protection,
real-copy individual correction and desktop Inventory handoff. Phone handoff
failed in its controlled route reply with `Route is already handled`, after a
reload had begun. Its trace is retained. The fixture now fences obsolete navigation
and aborted reads, propagates current-read errors and guarantees scoped cleanup.
Both desktop and phone handoff reruns pass with product/assertions unchanged.
This records the initial failure separately; it does not claim the initial group
passed. Existing preview/draft/handoff fixtures also clean correction records and
private files through the shared owned-fixture helper.

All six fixture namespaces and their correction records are absent. Original
seven-table projections are conserved; fresh before/after SHA verification passes
for all1092 existing originals /2832075218bytes. No new worker restart, physical
scanner operation, production deployment, verifier privilege or accuracy claim.
