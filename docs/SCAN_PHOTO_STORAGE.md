# Scan-photo storage allowance

The web service enforces a retained-original allowance per account and per batch.
Defaults remain 4 GiB per account and 1 GiB per batch. Set positive whole GiB values
in both the web and acquisition-worker containers' environments:

```
ACQUISITION_PHOTO_OWNER_LIMIT_GIB=64
ACQUISITION_PHOTO_BATCH_LIMIT_GIB=4
```

These example limits support roughly 10,000 retained 600 DPI fronts per account
at about 6 MB each, subject to image sizes and batch limits. They are allowances,
not allocated disk space. Choose them for the available upload disk and retention
policy. Per-image limits, ownership checks, serialized quota admission and seven-day
post-commit retention remain in place. Canonical images and processing evidence
consume additional disk space outside this original-byte allowance.

The standard and Unraid Compose templates forward these settings. Update the web
and acquisition-worker services after configuring them; no database migration or helper update is required.
Changing a setting on an older release with hard-coded limits has no effect.

When the allowance blocks a scanner upload, the page explains that uploads are
waiting and originals remain on the scanner computer. The helper retries its
existing retained files after space becomes available. Do not rescan those cards:
upload recovery does not feed the scanner or add copies to Inventory. An unfinished
physical segment stays started until its retained uploads and final receipt settle.

Every minute, retained originals at or above 90% of an account's allowance trigger
pressure cleanup. It removes the oldest eligible batches toward 80%, in bounded
passes of up to five batches and 25 photos per batch. Larger deletions resume on
later passes even after pressure falls. Normal seven-day expiry remains in place
when space is available.

Eligible batches are safely in Trash, or capture has ended and every candidate
has been added to Inventory or explicitly excluded. Completed batches must have
no pending capture slots or active processing. Unsettled scanner transfers and
the current batch of an ongoing section series are protected. Unfinished reviews,
active batches and cancelled batches outside Trash are preserved.

Pressure cleanup permanently removes the batch from all batch lists and deletes
its originals and previews; it shortens the normal Trash/recovery window. The
durable deletion marker commits before file removal, so interrupted deletion
cannot restore a batch with missing photos. Inventory copies and immutable audit
receipts remain. The scanner helper may remove its matching local originals only
after the server confirms byte deletion and the transfer has settled.

The allowance counts pending and retained originals, not physical disk capacity.
If protected batches consume the allowance, cleanup cannot free them; increasing
the allowance remains the recovery path. It does not remove unfinished reviews.
