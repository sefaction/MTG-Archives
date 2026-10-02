# Empty expected catalog claim diagnostics

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
Production worker code is untouched. A post-claim snapshot can expose a competing
lease but cannot alone prove the candidate selected by a racing claim; establish
that from a recurrence before proposing a source fix.

The disposable PostgreSQL acceptance deliberately creates one future-available
owned job, requires the real claim to remain empty, checks scoped scalar evidence
and original availability/attempt/output/updatedAt preservation, then makes only
that job eligible and verifies the original one-lease CAS without another report.
The job is removed in finally. This deterministic diagnostic qualification is
not a reproduction or resolution of the September29 failure.

Typecheck passed. Full acquisition/import validation and current-head CI are
recorded in the PR after completion. Test scripts are outside the web build-input
manifest, so the cumulative local Docker runtime does not need replacement.