# Empty expected catalog claim diagnostics

## Actual selection and lease outcomes — October 2, 2026

The fixture wrapper now observes the real claim operations when an expected claim is supplied. It retains up to32 selected head IDs/stages/revisions, each attempted lease CAS count, whether its transaction committed, and lookup presence/status/attempts/lease-presence/matching-lease booleans. Up to128 scalar events are kept, with an explicit dropped-event count. Raw query text/values, native inputs/outputs, owner/card names and lease tokens never enter this trace. It is published only for an empty expected result, together with the existing clocks and scoped post-claim snapshot. Ordinary production workers do not import this wrapper or tracer.

The retained real PostgreSQL diagnostic baseline failed because a deliberately lost CAS had no actual selection/CAS trace before owned cleanup. This is a missing-evidence baseline, not a reproduction of the unexplained September29 failure. Corrected qualification covers no selected eligible head, an actual competing lease between selection and CAS, and retirement after the committed CAS but before lookup. Snapshot failure preserves the original empty result and selection evidence as unavailable; a genuine selection failure, including a malformed code getter, propagates unchanged. Private sentinels and raw tokens are excluded. No sleeps, retries, eligibility advancement, owner/run fairness changes or production queue changes are added; the existing fixture database-clock+1ms policy remains unchanged.

A bounded probe repeats200 immediate initial catalog claims following two concurrent ordinary enqueue calls per cycle. Each must admit exactly one job and grant exactly one original lease, without a handler/provider call or retry. The fixture removes only its exact admitted source jobs and restores its original processing turn. Passing this probe cannot identify the original unobserved cause. Qualification passed the real PostgreSQL/import suite with owned cleanup, all 200 immediate claims, 797 unit tests, type/build/lint and ten input manifests. Both desktop/320px Inventory handoff cases passed in the cumulative local app. Web image 734d8c466b5c96436eae144274eea68b7b211d3222657c9073098490bdb30b84 matches all 525 inputs (source digest 1d92078fe85695470ec0f6f25dc8d50d6cc0ed99ea067c31932aa1c8b65d729e); both native services match all 257 lib/script files. Five services run with zero restarts/OOM. The original 10,280 Inventory rows/12,482 copies, 81 reviews and 907 photos retain their exact hashes. The historical failure did not recur; #498 remains open because its cause is still unknown. Evidence: ignored claim-evidence logs and verification/acquisition-2026-10-02T21-15-13-271Z.

Issue #498 retains an unexplained failed initial catalog claim. Later successful
runs and the database-clock probe do not resolve its cause. This batch adds
failure-only evidence at the existing disposable acceptance boundary.

The initial catalog check supplies its expected candidate to the fixture wrapper.
If the original claim returns no jobs, it retains the caller start/finish clocks,
observed database clock and exact fixture claim timestamp, then reads up to32
newest rows for only that candidate and requested stages. Scalars describe job
availability, attempts, limits, status, lease presence/expiry, current/input
revision, review/receipt/exclusion state, session phase, owner/creator activity,
and a snapshot database clock. The total matching-row count identifies truncation.
No original image, digest, native input/output, card or user name, credential,
raw lease token or saved review contents are emitted.

Diagnostics add no query before the original claim. They neither retry nor sleep,
and never change availability, priority, fairness, leases or acceptance results.
A diagnostic-query failure is recorded as unavailable without dumping query
values; the original empty result and failing assertion remain authoritative.
The existing fixture-only database clock +1ms allowance stays unchanged.
Production worker code is untouched. A post-claim snapshot alone cannot prove the
candidate selected by a racing claim. The added trace retains actual selection
and CAS operations for a future recurrence; it does not retrospectively identify
the September29 cause or justify a speculative production fix.

The disposable PostgreSQL acceptance deliberately creates one future-available
owned job, requires the real claim to remain empty, checks scoped scalar evidence
and original availability/attempt/output/updatedAt preservation, then makes only
that job eligible and verifies the original one-lease CAS without another report.
The job is removed in finally. This deterministic diagnostic qualification is
not a reproduction or resolution of the September29 failure.

Typecheck passed. Full acquisition/import validation and current-head CI are
recorded in the PR after completion. These verification scripts are included in the explicit web build-input manifest.
The next cumulative local image includes them and records its exact source digest;
their changes do not alter production worker behavior.
Local qualification PASSED all six acquisition/import runner steps, including the
new deterministic empty-claim privacy/preservation/lease assertions. Owned fixture
container and anonymous volume were removed. Result under ignored verification:
acquisition-2026-10-02T05-29-27-742Z, passed/cleaned true. Both final typechecks passed.
The original September29 failure remains unresolved and is not reclassified.


