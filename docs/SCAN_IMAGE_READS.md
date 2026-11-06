# Bounded scan-image and single-card review reads

Related to [#1004](https://github.com/sefaction/MTG-Archives/issues/1004).
Brian confirmed 85 images per pending batch on November 6, 2026. Whether the
reported batches were still uploading/processing remains unknown.

## Demonstrated cost and change

At main `8020c71f`, fetching one original or recognition-status record calls
`getAcquisitionPhoto`, which hydrates all candidates, observations, artifacts,
events, corrections and receipts in the batch before returning one photo.
The inline image also waits for a single-card review request that hydrates the
same full batch. Neither operation needs unrelated cards' review history.

Photo delivery now selects only batch ownership, visibility and run identity,
then repeats the existing live account/owner/Admin Mode authorization and photo
availability checks in the existing transaction. Single-card review reuses the
existing physical-card projection, including its complete observation/artifact
history and receipt. File reads/hashes, original bytes, preview selection,
private/no-store headers, recognition, saved decisions and Inventory writes are
unchanged.

## Author evidence

Measurements use a separate disposable PostgreSQL/app environment. Synthetic
1620×2160 JPEGs are about 2.5 MB each; one owner has one 85-image batch, another
has five. No native processing, actual scanner capture or production access is
claimed. Identical synthetic bytes are reused under distinct immutable fixture
photo identities; this is a stored-backlog check, not recognition qualification.

- Fifteen sequential photo lookups against the five-batch fixture reduce 15 SQL
  statements to eight per request. The round-robin five-batch metadata median is
  24.7 ms before and 7.3 ms after; file read/hash remains about 10–11 ms.
- Ten complete review responses, including five saved FR/Foil/LP decisions and
  five unreviewed cards, have identical serialized content before/after. Warm
  review-call medians are approximately 35.5 ms and 27.0 ms respectively.
- Fifteen real PostgreSQL access/availability controls pass: owner, foreign
  owner, Admin Mode, inactive/password-change accounts, inactive owner, Trash,
  deletion, unready/purged, cross-run, missing records and successful recovery.
- Focused checks: Linux35passes/zero skips; Windows34passes/one existing platform
  skip; no failures in either corrected run.
  Eight new controls execute the actual store functions, including the narrow
  projection, complete physical-card history and authorization boundaries.

## Performance limits and remaining work

Desktop 1366px and touch-enabled 320px checks load actual inline canvases and
Open original, with correct 1620×2160 dimensions and response byte counts. The
matched baseline first-display times are 2.9–3.9 seconds; candidate observations
are 2.8–3.2 seconds plus an unexplained 20.7-second first-desktop interval.
Both versions' original-image downloads complete in tens of milliseconds.
These runs do **not** reproduce or explain the reported progressive filling,
establish an end-to-end performance improvement, or complete #1004's acceptance.
The slow candidate interval remains retained; later passes do not explain it.

Earlier fixture import/storage setup failures, a phone test that did not scroll
its lazily loaded card into view, the JavaScript-versus-JSON undefined-property
comparison mistake, and a schema-invalid ready-state fixture are preserved in
private evidence. Corrected comparisons retain every serialized field and the
database readiness constraint. An earlier browser pair changed saved-review
state between runs and is retained separately rather than used as a matched
performance comparison.

Next: correlate an affected-installation observation with upload/processing
activity, first-byte, transfer and decode/display timings; investigate the
retained first-display outlier. Keep #1004 open with its original criteria.
Source-only lookup savings are not deployment, historical diagnosis, independent
review or reporter acceptance. Exact source/fixture hashes, timings, screenshots,
failed attempts and cleanup records stay in the local evidence and PR.
