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
