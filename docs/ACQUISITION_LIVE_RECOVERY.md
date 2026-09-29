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

Qualification is in progress; no complete PASS is claimed. The initial run stored
and prepared all24 uploads. The killed OCR job reclaimed its unmodified lease and
completed on attempt2; the LP correction remains present. All24 OCR/image stages
completed. Catalog/printing and final conservation/reload checks remain in flight.

An audit corrected two new test-only reload assertions: Advanced exposes condition
through a combobox value and persistent review through Reviewed status, rather
than a transient save message. The initial run uses the old checker; its native
observations are preserved privately. A tail-check failure must not be treated as
an app failure. The corrected test still needs acceptance before review readiness.

One container crash with24 uploads does not qualify a full large batch, host/DB/
browser-storage loss, production throughput, feeder safety or a future batch's
accuracy. Reused development scans and unknown physical grouping are not independent
trials. Docker samples do not prove an exhaustive peak or host/browser footprint.
Fresh final-evaluation material, conservative automatic acceptance and remaining
scale/restart cases remain under #463. Individual PR approval is required.
