# Controlled live OCR worker recovery

This reliability qualification under #463 uses existing acquisition, recognition
and review operations. It changes no app, model, threshold, upload or Inventory
behavior, and does not complete the recognition goal.

## Scope and acceptance

The opt-in browser test uploads24 preserved playable scanner originals through
normal library intake, including a selection larger than ten pending browser slots.
The first card completes recognition and saves an LP correction. The remaining23
are submitted to that session. When an owned OCR job is RUNNING, the test SIGKILLs
only the named local OCR container, verifies an unfinished lease with no output,
and starts the same image. The real90-second lease expires naturally. No priority,
availability, lease time or synthetic observation is changed.

One real successful upload acknowledgement is deliberately dropped after the
server saves the photo. Visible Retry upload operations are bounded to three per
photo and recorded, including naturally occurring failures. This verifies retained
identity and duplicate safety; it does not claim unattended upload recovery.

Acceptance requires exactly one additional attempt for the interrupted job;
one photo/artifact/slot/candidate per upload; all24 printings offered; preserved
human correction, revision and completed observations; zero automatic confirmation
or Inventory writes; saved condition/review after reload; and all24 incremental
review rows. First-choice accuracy is reported separately from candidate recall.
Docker CPU, reported memory/limit and PIDs are sampled during the run. Cleanup
restores the worker and removes only fixture-owned rows/files.

## Execution

From the actual cumulative local worktree, set `MTG_LOCAL_PILOT_TEST=1`,
`MTG_ACQUISITION_RESTART_TEST=1`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:13001`
and `MTG_ACQUISITION_PLAYABLE_SCANS_PATH` to the private corpus containing
`label-manifest.json` and `originals`. Run:

```text
node node_modules/@playwright/test/cli.js test tests/ui/acquisition-live-recovery.spec.ts --workers=1
```

The test verifies a local named-pipe/Unix Docker endpoint and MTG Archives project
label, with the OCR worker initially running. It is skipped in ordinary CI and
without explicit restart opt-in. No production or scanner operation is involved.
The current cumulative build includes sibling UI #488; this test branch is based
on #490 and does not include that UI implicitly. Private diagnostic reports under
`.local-data/recovery-qualification` retain run/job identity, digests, timings and
resources without original image bytes, credentials or unnecessary full paths.

## Current evidence and limits

The corrected local browser qualification passed (1/1, 10.2 minutes) on the
cumulative #486–#490 app plus separate Simple/Advanced #488. All 24 originals
were ready, with 24 artifacts, slots and candidates and 120 completed stage jobs.
All 24 expected printings were first/offered. There were zero automatic decisions
and Inventory writes. The saved LP correction/revision and completed observations
were unchanged, survived reload, and all 24 incremental review rows loaded.
Owned fixture cleanup passed; the web stayed healthy and workers running with
no reported OOM kill.

The interrupted OCR job completed on attempt 2, 96.669 seconds after SIGKILL,
using the unchanged 90-second lease. One visible Retry recovered the deliberately
dropped successful acknowledgement without adding a second card. This is explicit
user-style intervention, not unattended upload recovery.

Twenty-one Docker samples recorded these maxima during the corrected run:

| Worker | Observed memory maximum | Local cap | Observed CPU maximum | PIDs maximum |
| --- | --- | --- | --- | --- |
| OCR | 952.2 MiB | 2 GiB | 99.80% | 28 |
| Visual | 1,346.56 MiB | 3 GiB | 100.07% | 39 |
| Printing | 965.9 MiB | 1 GiB | 98.81% | 40 |

Printing's observed memory approached its local cap; this is not a larger-batch
resource pass. Samples are snapshots, not exhaustive peaks or host/browser usage.
The sanitized result is in tools/acquisition-eval/live-recovery-results.json;
private native observations, exact run/job identities and original bytes remain
outside the repository. The 24 reused scans are not independent accuracy trials
and must not be added across repeated runs as new sample counts.

### Prior attempts retained

The initial run
completed all 120 processing jobs for 24 uploads and recovered the interrupted
OCR job on attempt 2. Saved review, immutable completed evidence and artifact
counts passed before a new checker incorrectly read Scryfall IDs from a DTO that
intentionally exposes local Card IDs. The checker now resolves label identities
after processing, solely for scoring. Advanced reload assertions also use the
condition combobox value and persistent Reviewed status.

A second run recovered its OCR job on attempt 2, but reproduced existing #468:
24 reserved/saved photo records, 23 ready photos/artifacts/candidates and 23
completed pipelines. One retained upload required the existing Retry control.
The checker did not use that control; the run was stopped after confirming it
could not complete without intervention, and its evidence was preserved. This
is not a full PASS and does not establish the exact exhausted transaction.

The corrected run records bounded visible retry interventions and the controlled
lost acknowledgement, with the real crash, lease, native processing and final
conservation checks. #468 remains open; this test
does not implement unattended upload recovery or modify app transaction behavior.

One container crash with24 uploads does not qualify a full large batch, host/DB/
browser-storage loss, production throughput, feeder safety or a future batch's
accuracy. Reused development scans and unknown physical grouping are not independent
trials. Docker samples do not prove an exhaustive peak or host/browser footprint.
Fresh final-evaluation material, conservative automatic acceptance and remaining
scale/restart cases remain under #463. Individual PR approval is required.
