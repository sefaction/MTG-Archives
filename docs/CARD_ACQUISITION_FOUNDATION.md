# Acquisition P1 pure foundation review

## Scope and branch

`feat/acquisition-foundation` depends on unmerged planning branch
`docs/card-acquisition-plan` / PR #315, built from main `7ba9399`.
This completes only the first bounded implementation batch in the
[user kickoff](reference/card-acquisition/implementation-kickoff.md).
Issue #303 remains open for persistence/ownership; #302 remains the initiative.

- `lib/acquisition-domain.ts`: version 1 session/event/placement contracts,
  pure evidence receipt, state transitions, count correction, allocation,
  recognition proposal/review separation, commit-preview readiness and exact fixture.
- `tests/acquisition-domain.test.ts`: deterministic, synthetic inputs; no private
  images, scanner, network, model, GPU or real user data.
- Existing `readStorageLayout`, `storageSections` and `remainingStorageSpace`
  supply layout/default/selected-section arithmetic. Direct location rows exclude
  descendants. Other-session pending counts are warnings, not reservations.

No production adapter calls this module yet. There is no UI, route, migration,
new dependency, queue service, Docker change, driver or inventory mutation.
The local Docker review image is unchanged because this batch is pure code with
no runtime entry point. Runtime changes in later batches still require Docker review.

## Acceptance evidence

All twelve required kickoff cases map to executable behavior tests by numbered name:

| Case | Proven pure behavior |
| --- | --- |
| 01 | Explicit physical ID joins front/back observations; missing side is uncertain. |
| 02 | Six detections in one artifact yield six provisional candidates; reasoned count confirmation and false-detection exclusion preserve original evidence and correction history. |
| 03 | Repeated episode observations count once; an identical-looking next episode counts separately. |
| 04 | Same event identity/payload replays harmlessly, including after cancellation; changed event/artifact/physical/observation identities conflict without partial mutation. |
| 05 | Unknown printing/finish affects readiness only, not physical/target count. |
| 06 | 800 minus 537 is 263; selected-section/overall minimum, full/overfull, unknown, default Vault, unconfigured/unsectioned and direct-versus-descendant cases reuse existing semantics. |
| 07 | Zero fill cannot start; unknown requires explicit manual or untargeted policy. |
| 08 | Exact fixture: 263 acquired plus 37 unconsumed. Best-effort/logical receipt: 263 allocated plus 37 retained overflow, all 300 artifacts kept. |
| 09 | Acquisition/spatial order stays stable despite reversed receipt and recognition completion. |
| 10 | Boundary conflict/multifeed stays uncertain; exact fixture refuses to claim certainty; acquired native items cannot be discarded as false detections. |
| 11 | Stop permits draining, cancel preserves evidence/pending/overflow, unsupported controls and invalid transitions fail. |
| 12 | Target reached, recognition and review are independent of stock; readiness produces only a preview decision requiring persisted revalidation. Later proposals preserve human decisions. |

Two additional cases prove artifact receipt before detection and that new physical
evidence invalidates old count confirmation/review while retaining history.

## Verification record

Environment: Windows, Node `v24.16.0`, npm `11.13.0`; CI uses Node 22/Linux.

- `npm.cmd ci --no-audit --no-fund`: existing lockfile installed, 433 packages;
  no dependency/lockfile changes.
- `npx.cmd tsx --test tests/acquisition-domain.test.ts`: 14 passed, no skips.
- `npm.cmd run verify:core`: passed with exit 0, including Prisma client generation,
  typecheck, 634 unit tests, production Next build and client-manifest guards.
  Log: `%TEMP%/mtg-acquisition-foundation-core-final.log`.
- `git diff --check`: passed for authored changes.

An initial standalone typecheck before Prisma generation failed on missing generated
Prisma exports. The normal core sequence generates those types and passes.
The first redirected core run reported a PowerShell wrapper error on Prisma's stderr
informational line; the rerun captured the actual process exit (0) and combined log.
No app code workaround was needed.

The final small false-detection guard is covered by the focused suite and typecheck;
the PR's exact-head Core and PostgreSQL regression checks must also pass before merge.
No acquisition database, browser, image-engine, phone, native TWAIN or hardware test
was performed or claimed. Existing PostgreSQL CI regression checks do not prove
future acquisition commit concurrency. No migration or Docker reload is needed here.

## Deliberate limits and next batch

This is a single-run, in-memory domain. `physicalCandidates` is an evidence-derived
candidate count, **not a measured total when uncertainty remains**. Count corrections
can confirm a candidate or tombstone a false detection. Full split/merge, set-aside,
multi-section acknowledgement and destination-change workflows belong to the later
persisted reconciliation/review batches; original evidence must remain accessible.

The supplied actor/owner IDs are data, not authentication. Receipts are not durable
ACKs or network exactly-once guarantees. Artifact digests describe identity metadata;
no file bytes have been written or verified. Recognition proposals are synthetic
attribute values, not engine results. The exact source fixture proves its own
one-item boundary only and does not qualify TWAIN physical stop behavior.

**Next smallest batch:** P1/#303 additive persisted owner/session/run/event/candidate/
observation records, ownership enforcement, optimistic revisions and durable event
replay/conflict transactions. Preserve these pure invariants; run disposable real
PostgreSQL uniqueness, cross-owner and concurrent receipt tests. Finalize count
correction persistence without creating every future schema up front. Gate A is only
partially satisfied until this passes.

Remaining gates:

- P2: durable orchestration, fenced jobs and versioned input/evidence backend contract.
- P3-P5: private desktop/direct phone input, format/orientation/HEIC evaluation,
  real geometry and measured CPU exact-print/language recognition on held-out images.
- P6-P8: usable correction/placement review, freshly authorized transactional inventory
  commit with audit/provenance/all-writer coordination, browser and recovery acceptance.
- #442: live browser/PWA/webcam episodes, quality, rearm and durable-ACK recovery.
- #443: approved location-bound folder finalization, ordering, retry and quarantine.
- P9/P10: secure outbound Windows agent and actual DSM/virtual-source tests once
  contracts are stable; not blocked on every image UI feature.
- P11/P12: actual fi-7160 safety/pairing/count/stop/overscan qualification; optional
  fi-6130Z/fi-8170 afterward. Isolated diagnostic/corpus work can begin on arrival.
- #444: measured optional GPU profile with CPU fallback, actual execution-provider
  diagnostics, licenses and accuracy requalification. Hardware absence blocks only
  the relevant hardware gate.

No question blocks this batch. Stop at its PR review boundary; do not merge, deploy
or automatically begin persistence. The user will review questions in the morning;
if a later consequential decision blocks progress, pause the goal pending that answer.
