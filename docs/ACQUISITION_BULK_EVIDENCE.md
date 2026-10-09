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
