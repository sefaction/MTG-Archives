# Incremental bulk-review choices

Issue #537; isolated on PR #533, not the scanner or recognition branches.

## Behavior

Proposals still arrive in groups of at most four, in capture order. Appending a
new group preserves the current checkbox state. Explicit choices use photo IDs,
not visible indices. Reload and reopening retain exclusions; an explicitly
checked choice cannot authorize a different printing after reload.

Only the current preview may publish rows, errors or loading state. Reload,
close and unmount abort the old read requests and invalidate their results.
Aborting the browser read does not cancel server recognition. The loading total
is the snapshot requested for that preview, even if live slots change meanwhile.
Batch identity resets the component. Recognition thresholds are unchanged.

Draft exclusions, final per-photo draft checks, server review revisions and
explicit Inventory addition remain in their existing paths. Preview does not
save reviews or add Inventory. Checkbox choices are memory-only; browser reload
continues to use the existing default selection behavior.

## Evidence and limits

The initial baseline fixture failed because an offscreen individual review had
not loaded; this was a test setup failure. The corrected owned 32-photo baseline
reproduced a user deselection becoming checked again after later groups arrived.
Private logs/traces remain under .local-data/bulk-preview-baseline-artifacts.

The controlled browser scenario exercises delayed groups, all 32 visible rows,
reload supersession, close/reopen, and no preview writes. Synthetic CARD_SCAN
uploads and supplied proposals test UI behavior, not recognition accuracy or
scanner hardware. Desktop and 320px screenshots and final local build evidence
will be recorded after the implementation is loaded and checked.

## Local acceptance, September 30, 2026

PR #538 on individually unapproved #533. App9837212, cumulativebc7bf74.
Core verification passed: Prisma generation/typecheck,732 units, Windows build
and all client-manifest guards. Final focused typecheck/lint also passed.
Linux cumulative build22763 and web-only reload82266 completed0; host login200.
Exact image6460e4a56c13d1a9aeca18fa4b8592018c7161b52eba9fc8ca71dbafb8748b68,
495 source inputs, digestc0090fc4a44f76e8129c3cc6a5bdf156872ae78787da87a943017ec755441a98.

Grouped browser97971 passed3/3 in1.2m:32-photo bulk40.4s,14-photo draft actions21.7s,
three-photo fast corrections9.6s. The bulk case covered delayed incremental groups,
explicit approval of a changed printing, all32 rendered rows, superseding reload,
close/reopen and old callbacks draining. Zero review/Inventory writes occurred in
that preview. The existing draft case intentionally performed its scoped fixture
Inventory writes and duplicate-safe recovery, then cleanup. Desktop1366x768 and
320x700 bulk layouts inspected; no phone overflow. Synthetic bulk proposals have
no printing image; this is not an image-rendering throughput or accuracy benchmark.
All fixture records/files were scoped and cleaned. No native helper/motor operated.
All three original-head CI checks passed; refreshed test/docs head needs fresh CI.
