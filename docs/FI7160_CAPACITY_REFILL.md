# fi-7160 counted capacity and refill qualification

Implementation [PR599](https://github.com/sefaction/MTG-Archives/pull/599)
and diagnostic [PR598](https://github.com/sefaction/MTG-Archives/pull/598)
merged after individual user approval on October 3, 2026. Main at
`77994170eb39963875f6a118fea17807103fb253` exactly matches the qualified local
source tree. Tracking issue
[597](https://github.com/sefaction/MTG-Archives/issues/597) remains open for physical
capacity/refill acceptance. No production deployment has occurred.

## Behavior

The explicit **fi-7160 (count controlled)** source uses a separate x86 TWAIN
companion with PaperStream IP 3.40.2.1815, legacy DSM, simplex native RGB24,
600 DPI and the previously observed 2.7 by 3.6 inch driver frame. It requires
accepted/read-back CAP_XFERCOUNT and CAP_AUTOSCAN=false before durable server
authorization and checks both again immediately before one source Enable.
Unsupported settings, a different driver/profile, or a conflicting helper refuse
this route. It never falls back to an unbounded scan or cancels after an image
arrives. Generic NAPS2 sources retain their existing behavior.

CAP_XFERCOUNT counts images. Physical card boundaries remain unknown, so the
operator must inspect emitted cards and confirm the hopper remainder and clear
transport. Original images, including overflow, remain retained. Stop finishes
the current finite segment and prevents another segment; uncertain active
transport is not killed or automatically retried. Setting restoration failures
produce an error rather than successful completion.

Counted admission and claim use fresh section and parent capacity under the same
location locks as Inventory. Committed copies, scanned but uncommitted candidates
and reserved unfinished acquisition targets consume space. Explicit Inventory
commits subtract their receipts from pending space without releasing the occupied
capacity twice. Sections in a divided location require explicit selection.

83 available spaces select a logical target of 83. Reaching the selected target
requires physical reconciliation and a new section choice before another batch.
Reported early exhaustion pauses the unfinished batch. After reconciliation,
explicit refill readiness and Resume create a new physical segment with a new
execution identity, the same logical batch/destination, and the remaining target.
Earlier images, positions and saved reviews stay intact. Recovery only replays
saved transfers; it never authorizes another physical feed. End batch with saved
cards releases only the unfed reservation. Preview and adding copies to Inventory
remain separate explicit actions.

## Software evidence

- 801 unit tests, type checking, lint, production build and ten client manifests
  passed. Frozen final build and focused lint/type checks passed after the final
  UI wording changes.
- Disposable PostgreSQL acquisition and shared import qualification passed,
  including the new counted suite. Final acquisition took 105644 ms and import 41045 ms;
  the fixture and anonymous database volume were removed.
- The real database suite covers synthetic 83-image capacity, pending/committed
  conservation, explicit section choice, concurrent parent reservations,
  no-START stale capacity, same-batch early-empty/refill, concurrent refill
  idempotency, stale-segment replay, saved-review preservation, queued refill
  cancellation, early ending, and retained overflow/error refusal.
- Counted native channel selftests exercise the actual companion protocol with
  motor-free fixtures: profile refusal, one START, early empty, retained overflow
  and restoration failure. Existing authorization, lost ACK, recovery and retention
  selftests also pass. Helper 0.4.0 source build and self-contained installer pass
  their release-material checks; the installed helper remains 0.3.8.
- The new companion negotiated the actual driver/profile, read back target one
  and ahead-scanning disabled, restored settings and closed successfully. No START
  command or source Enable was sent, and zero images resulted. This verifies
  preparation/restoration only; it is not an integrated physical feed.
- Counted desktop/phone browser qualification passes at 1366 and 320 pixels,
  covering one-card selection, pending capacity, explicit next section,
  early-empty pause/reload and Resume under the same batch. Screenshots inspected.
  Seven existing alignment/authorization/preflight/rejected-start/Start-replay
  cases pass. Final qualification covers eight unique browser cases. One legacy
  rejected-Start assertion expected a partial batch; it now checks zero sessions
  after atomic refusal and the existing cancellation/recovery messages. Both
  affected rejection/lost-ACK cases passed on repeat, with their failure retained.

An initial migration attempted to drop a unique index owned by a constraint and
was corrected to DROP CONSTRAINT. Concurrent refill exposed a raw serialization
conflict; whole-transaction retries now cover only PostgreSQL 40001/40P01 and
Prisma P2034. Genuine failures propagate. Initial core invocation/shared-client
Windows lock/lint failures and a premature browser-fixture poll were corrected;
their failed logs remain private alongside the passing runs.

Final review reproduced [issue600](https://github.com/sefaction/MTG-Archives/issues/600):
a rejected Start on a busy helper left an orphan acquisition session/reservation.
Session creation, logical START and scanner-run admission now share one serializable
transaction. The regression checks unchanged session count and capacity after
refusal. Retirement checks now pause before and after atomic admission rather
than the former three creation commits; legacy partial sessions, restored markers,
accepted-run adoption and saved-evidence fences remain covered. The targeted
suite passed in 23032 ms, followed by the full acquisition/import qualification.
The failed baseline and the obsolete test-boundary failure are retained.

Private evidence: `.local-data/counted-core-qualified.log`, final build/type/lint
logs, `counted-capacity-postgres-qualified.log`,
`.local-data/verification/acquisition-2026-10-03T00-28-16-007Z/result.json`,
`counted-helper-native-corrected.log`, `counted-source-install.log`,
`counted-installer.log`, `counted-browser.log` and
`counted-browser-corrected.log`. Final atomic evidence is in
`counted-admission-baseline.log`, `counted-admission-qualified.log`,
`counted-capacity-postgres-atomic-qualified.log`, `counted-core-atomic-qualified.log`,
`counted-actual-profile-no-enable.log` and
`.local-data/verification/acquisition-2026-10-03T01-03-23-422Z/result.json`.
Final browser evidence is `counted-browser-atomic-qualified.log` (seven passes and
the obsolete assertion failure) plus `counted-browser-rejection-qualified.log`
(both affected cases pass). Five CI checks passed on implementation commit
`40d54955dce35e9b79282cc18e59a5b2db8ffef6`; GitHub is authoritative for later
documentation/test revisions.
No private card images or credentials are committed.

## Local review environment

The cumulative local review uses `mtg-archives-web:counted-refill-qualified`, manifest
`a75562eb7d1a931d8ebb2167b08a130461c1618ca6f98c19a61cd29c947441fc`, with 530
exact source inputs and digest
`db1bc95bf83ecd667923921b4d2e2a09ebc34ea454fa0324232a0e01a6a60e7c`.
All three native workers match 348 source/Prisma inputs each. Their original model
and index generations were preserved. Only web and the five acquisition services
were reloaded using the existing complete Compose stack plus a review overlay.

Before physical fixtures, original Inventory (10280 rows/12482 copies), saved
reviews (81) and photos (907) retained their exact baseline hashes after migration
and browser fixtures. Unrelated services and worktrees were preserved.

## Physical acceptance

The isolated diagnostic results in [FI7160_COUNTED_FEED.md](FI7160_COUNTED_FEED.md)
remain valid: one of three twice and two of three once, with undamaged exits,
remaining cards wholly in the hopper and clear transport.

The integrated local website and validated source helper 0.4.0 then performed
the following small physical tests with the operator at the fi-7160. Every Start
and refill was explicit, followed fresh readiness, and was issued once. The
source helper was verified as sole owner before each movement. All runs reached
DRAINED without native error; full-target runs completed their logical batch and
early exhaustion paused it. The installed helper remains 0.3.8; Unraid was not
deployed or used for these tests.

| Integrated test | Actual request and saved images | Physical observation and application result |
| --- | --- | --- |
| One card with three loaded | Manual target 1; one image; 6739 ms | Operator said "yep, it scanned one card", directed continuation, then confirmed the two remaining cards were still loaded and ready. Preserve these replies without treating them as a separate detailed surface inspection. |
| Section A's remaining capacity | Automatic target 2, no manual quantity; two images; 10044 ms | Operator explicitly confirmed two undamaged exits and empty hopper/transport. A reached zero free spaces with three pending scans and no Inventory write. |
| Early-empty section B | Automatic target 3 with one card loaded; one image; 6662 ms | Operator confirmed one undamaged exit and empty hopper/transport. Batch paused with two still needed; all three spaces remained reserved. |
| Explicit refill of section B | Remaining target 2; two images; 9276 ms | Same logical session `76f1dbb5-d52b-4326-b458-2db9082a87d7`, new physical segment 1 and offset 1. Three saved positions 0, 1, 2; batch completed. Operator explicitly confirmed two undamaged exits and empty hopper/transport. |
| Capacity boundary with a hopper remainder | Automatic section C target 2 with three loaded; two images; 8830 ms | Operator explicitly confirmed two undamaged exits, the third wholly in the hopper and clear transport. After reconciliation, next-section selection was required and Start remained disabled until a section was selected. |
| Explicit next section for the remainder | Automatic section D target 1; one image; 5862 ms | Fresh readiness and explicit section selection preceded Start. Operator confirmed one undamaged exit and empty hopper/transport. |

During final refill inspection the operator initially selected the problem or
uncertain-transport answer. Further feeding stopped immediately and the physical
count remained unconfirmed. The operator clarified that the selection was a
mistake and explicitly reported two undamaged exits with everything empty. Only
then was reconciliation recorded. This was a corrected answer, not an observed
transport fault or a scanner retry.

Nine owned fixture photos are retained. Original Inventory (10280 rows, 12482
copies), 81 saved reviews and 907 original photos retain their baseline hashes;
only owned fixture photos are excluded from the original-photo comparison. The
fixture has zero Inventory items and zero Inventory audit writes. Review and
explicit Inventory confirmation remain separate from physical scanning.

Private evidence includes `integrated-capacity-two-run.log`,
`integrated-start-early.log`, `integrated-resume-two.log`,
`integrated-boundary-start-two.log`, `integrated-boundary-start-next-one.log`,
the stage result JSON, screenshots, helper journals and
`integrated-final-conservation.log`. Card images,
browser authentication state and helper credentials remain private and uncommitted.

Actual 83-card feeding remains unqualified. Synthetic 83-image software tests do
not establish that physical result. Require fresh readiness before each feed and
stop on overfeed, damage, uncertain transport or conflicting ownership.
