# Explicit photo-to-Inventory commit

The local first path supports one physical card per Android/desktop JPEG, PNG or
WebP photo. Recognition proposes printings; the user reviews the printing,
condition, finish and language. No scan or review automatically writes Inventory.

## Review workflow

1. Choose a location/section and capture or upload cards. Known remaining capacity
   limits admitted slots; unknown capacity shows an open-ended running count.
2. Save card reviews, using batch attribute defaults and per-card overrides.
3. Stop capture. Already admitted uploads and unfinished cards stay recoverable.
4. Select reviewed cards, choose the receipt destination, and preview the exact
   subset. Select reviewed cards chooses up to 500 per confirmation; this is a
   transaction bound, not a total capture limit.
5. Check the copy count, card details, current direct occupancy and section/overall
   capacity. An overfill requires a physical-space checkbox and recorded reason;
   choosing fewer cards or a different destination remains available.
6. Explicitly add to Inventory. Successful cards show Added to Inventory and cannot
   be retaken or re-reviewed. Make later changes through Inventory. Other cards
   remain staged and retain their photos.

## Integrity boundary

The server reauthorizes the current owner/Admin Mode on preview, commit and replay.
It locks the session then destination inside the bounded serializable retry helper.
Current photo generation/digest, physical count, review, printing eligibility,
owner, destination layout/occupancy/revision and session revision form the preview
token. A stale token requires a new preview, including fresh overfill confirmation.

A commit creates separate Scan provenance lots grouped only by identical reviewed
printing and attributes within that operation. Original opener is explicitly null;
owner is not opening provenance. Inventory, before/after audits, immutable receipt
snapshots, unique physical-candidate membership and seven-day expiry dates write in
one transaction. An audit/membership failure rolls back the complete operation.

The same request key and payload returns its original receipt, including after a
lost response or later Inventory deletion. Changed payloads conflict. A different
key cannot add an already committed candidate. Database uniqueness and same-run
foreign keys reinforce the application checks. Membership and original Inventory
IDs survive live stock edits, splitting or deletion. There are no application
receipt-edit/delete endpoints; database administrator access is not restricted by
this application ledger.

Only settled selected phone slots can commit. STOPPING allows other unselected
uploads to drain without claiming that the whole run is complete. General multi-
card artifacts, native scanner commits and cross-provider reconciliation are not
released by this first phone/photo implementation.

## Photo expiry

The ordinary local acquisition worker checks once per minute and handles at most
25 expired photos per pass. Both the stored expiry and actual receipt age must be
at least seven days; pending candidates cannot qualify solely through a stray
expiry value. It removes only each eligible UUID's original and preview files,
then marks the retained photo metadata purged. Interrupted unlink/mark operations
retry safely. Commit membership, hashes, review decisions and audit history remain.
Upload acknowledgements never rewrite already READY files, including expired ones.
An abandoned unfinished retake cannot resume after its physical card commits.
Unfinished candidates and their bytes remain; backups have their own retention.

## Local verification

The disposable database fixture covers selected-subset review, current ownership,
audit/membership rollback, same-request races, different-key duplicate rejection,
stale occupancy/layout previews, fresh audited overfill, competing last-space
sessions, post-commit edit/retake rejection, historical replay after live deletion,
seven-day file expiry, pending-photo protection and interrupted purge retry.
The real-photo browser fixture adds explicit commit and lost-response replay after
actual OCR/review, with phone/desktop layout checks. Actual Android camera/device
acceptance remains separate from the fake-camera Chromium fixture.


Database evidence: `acquisition-2026-09-27T18-53-57-132Z` under ignored local
verification output includes the abandoned-retake regression and all receipt,
capacity and file-expiry fixtures. Local core passed 647 units plus typecheck,
production build and manifests; the final Docker build repeats runtime lint/type
checks. Real-photo browser results are recorded in the work checkpoint and PR.
