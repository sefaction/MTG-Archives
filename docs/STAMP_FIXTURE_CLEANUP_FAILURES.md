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

Two ordinary retained-image native/browser cases pass in 324.1 seconds with
zero failures, skips or retries. They cover two stamped expectations and the
clipped-margin Boggart review, desktop/phone rendering and saved LP review/reload,
with all original printing/stamp and zero Inventory-write assertions unchanged.

A private variant of the Boggart fixture injects the early feedback error only
after all main-body assertions finish. Its completion marker is true, all
original assertions are conserved, and the failed browser result remains
failed (86.2 seconds). The report contains the cleanup aggregate and its sole
injected cause, with no other error. This qualifies the actual native cleanup
failure boundary, not an additional passing browser case. The first report
gate incorrectly expected one error entry; Playwright reports both the wrapper
and cause. The corrected gate explicitly requires that pair and body completion;
the browser test is not rerun or relaxed.

After all browser/native runners are terminal, every stamped fixture owner,
User, location, acquisition session, AuthSession and all nine feedback-model
namespaces are absent. Seven original full-row source projections match the
fresh pre-run snapshot. All 1,094 retained ready originals, 2,845,198,201 bytes,
match their original identities, lengths and actual stored SHA-256 values. Nine
substantive feedback projections and the existing private correction file's
identity/size/SHA are unchanged; every remaining private directory has its
existing account. All 16 ordinary services, including web, retain identical
identities/images/lifecycle states/storage/limits. Web remains healthy with
zero restarts/OOM. The exact 598-input application source is unchanged.

The existing local application and native images remain unchanged: this batch
edits only test fixtures, controls and this report. Cumulative test sources are
loaded alongside the existing
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
An initial read-only audit setup failed SQL-string quoting before any audit operation;
the corrected baseline passes. Private logs, originals, reports and failure
artifacts stay ignored under `.local-data`. All three required checks pass on
implementation head `0d7233f38f74379bba6df3a6b5408739aba370de`; exact final
report-head CI is tracked live on the PR. The separate reviewer handles draft
readiness, human approval and merging.

These reused development scans qualify workflow and cleanup, without new
independent recognition accuracy or physical-feed acceptance. Broader #692/#463
acceptance stays open. Production/library lifetime, 64 decimal GB/owner,
2% controls, recognition policy and separate explicit Inventory commit are
unchanged. No production, physical scanner, model or worker-policy change.
