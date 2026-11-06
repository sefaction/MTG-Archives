# Scan-photo storage and cleanup

Intake has no aggregate account or batch allowance. Keep scanning in the same logical batch across automatic internal feeds; saved originals do not require review or cleanup before another feed. See [continuation](CONTINUOUS_SCANNING.md).

The existing per-image validation, immutable writes, ownership checks, 2 GiB free-disk reserve, durable scanner spool and seven-day post-commit retention remain. Genuine disk exhaustion leaves the same uploads pending and retryable; free actual storage space before retrying. No protected original is deleted to make room.

`ACQUISITION_PHOTO_OWNER_LIMIT_GIB` keeps its existing 4 GiB default only as a pressure-cleanup watermark for the acquisition worker. It never blocks intake. `ACQUISITION_PHOTO_BATCH_LIMIT_GIB` is deprecated and no longer limits a batch. Existing Compose forwarding is retained for upgrades; no database migration or helper binary change is required. Historical allowance warnings clear when the same uploads succeed.

## Preserved pressure-cleanup policy

Every minute, retained originals at or above 90% of the account cleanup watermark trigger
pressure cleanup. It removes the oldest eligible batches toward 80%, in bounded
passes of up to five batches and 25 photos per batch. Larger deletions resume on
later passes even after pressure falls. Normal seven-day expiry remains in place
when space is available.

Eligible batches are safely in Trash, or capture has ended and every candidate
has been added to Inventory or explicitly excluded. Completed batches must have
no pending capture slots. All batches must have settled uploads and no active
processing. Unsettled scanner transfers and
the current batch of an ongoing section series are protected. Unfinished reviews,
active batches and cancelled batches outside Trash are preserved.

Pressure cleanup permanently removes the batch from all batch lists and deletes
its originals and previews; it shortens the normal Trash/recovery window. The
durable deletion marker commits before file removal, so interrupted deletion
cannot restore a batch with missing photos. Inventory copies and immutable audit
receipts remain. The scanner helper may remove its matching local originals only
after the server confirms byte deletion and the transfer has settled.

The cleanup watermark counts retained original bytes, not physical disk capacity.
Protected batches remain protected even above that watermark; it is not an intake
cap. Actual disk pressure requires freeing real space without removing unfinished reviews.
