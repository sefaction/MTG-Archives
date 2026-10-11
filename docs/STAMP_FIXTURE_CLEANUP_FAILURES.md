# Stamped-scan fixture cleanup failures

Resolves [#732](https://github.com/sefaction/MTG-Archives/issues/732), a
follow-up to the remaining qualification audit in
[#692](https://github.com/sefaction/MTG-Archives/issues/692).

An early correction-feedback cleanup error bypassed the stamped-expectation
fixture's later source teardown and final sweep. Stamp visibility combined
feedback cleanup and source deletion in one database call, so the same error
also skipped source teardown and had no later feedback sweep.

Both actual outer finally blocks reproduce this on main
`cb39cac5ab28debca5c2c945159687a07155882b` with disposable PostgreSQL records.
An injected error after owner authentication/session retirement, before feedback
deletion, leaves one exact-owned Player, User, location, correction account and
private directory per fixture. Both failures remain visible. The two exact
temporary owners are recovered separately; no ordinary owner is removed.

The two fixtures now independently attempt early feedback cleanup, optional
report writing, source teardown and final feedback cleanup. Every cleanup error
is retained in an AggregateError. A failed step cannot suppress later attempts,
and the controlled failure remains a failed operation.

Source-derived controls execute the actual cleanup blocks. The unchanged code
passes one of eleven controls and fails ten; the candidate passes all eleven,
including each single failure, multiple failures and normal sequencing. Actual
PostgreSQL early-error probes on both candidates preserve the error while
leaving zero owned Players, Users, locations, accounts or directories. An AST
comparison preserves all 86 original expect calls and both complete main test
bodies, including original native gates, deadlines, phone layouts, stamp/printing
checks, saved review/reload and zero Inventory-write assertions. Types pass.

Retained-image browser qualification, the actual native early-cleanup-failure
boundary and final conservation are pending. The existing local application and
native images remain unchanged: this batch edits only test fixtures, controls
and this report. Cumulative test sources are loaded alongside the existing
qualified web image
`sha256:e896fcc3edd0b52a3d0aeae7286da06abef69d9ca31102008139024b359dc2bc`,
598-input source
`6a6445083b93772daf23045e6edceb190f6502f63aacaab6123373280fc0117c`.

The fresh storage baseline verifies 1,094 ready retained originals,
2,845,198,201 bytes, against their stored SHA-256 and size. It captures nine
substantive feedback projections and all private correction files. Only the
correction account's ordinary maintenance lastCleanupAt/updatedAt timestamps
are excluded. Seven original collection/acquisition table projections and all
16 ordinary service identities/lifecycles/storage/limits are recorded separately.
An initial read-only audit setup failed SQL-string quoting before any operation;
the corrected baseline passes. Private logs, originals, reports and failure
artifacts stay ignored under `.local-data`.

These reused development scans qualify workflow and cleanup, without new
independent recognition accuracy or physical-feed acceptance. Broader #692/#463
acceptance stays open. Production/library lifetime, 64 decimal GB/owner,
2% controls, recognition policy and separate explicit Inventory commit are
unchanged. No production, physical scanner, model or worker-policy change.
