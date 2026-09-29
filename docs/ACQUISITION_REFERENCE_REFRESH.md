# Local public reference maintenance

This batch follows printing PR #477 and stays within recognition #463.
Production Compose is unchanged. The optional
`docker-compose.reference-maintenance.local.yml` service has public references,
indexes, model weights and maintenance state mounted outside disposable images.
It has no uploads, database credentials, sessions or Inventory access.

## Refresh order

1. Check the official `api.scryfall.com/bulk-data/default_cards` metadata.
   Accept only its bounded HTTPS `data.scryfall.io` gzip JSONL source; do not
   follow arbitrary redirects. Keep complete source bytes and hash them.
2. Serialize maintenance with the existing crash-released writer locks.
   Build a separate catalog generation with the existing reference planner.
   Every paper printing and image face stays represented; unavailable images
   remain explicit. Failed/PENDING downloads cannot activate an index.
3. Reuse unchanged versioned image URLs under the same persistent reference
   root. New/changed images get separate generation paths. Existing bytes are
   never overwritten, copied into a second full library, or baked into an image.
4. Public file verification records bind byte digest, size and file times.
   The initial adoption verifies old assets; later unchanged files avoid
   repeated reads. Changed files require hash verification again. Native
   recognition still hashes every reference it actually uses. These producer
   records do not alter private photo checks or recognition thresholds.
5. Reuse normalized vectors only for matching reference identity, image digest,
   encoder code/model/transform and library versions. CPU/CUDA build suffixes
   follow the existing runtime compatibility rule. Metadata is updated
   separately. Only new/changed bytes need embedding; committed batches resume
   after interruption.
6. Publish a complete immutable matrix/reference generation and its archived
   manifest, then replace `index.json` atomically. Preparation/provider failures
   preserve the previously published index. Cleanup/state recording after a
   successful publication reports its own outcome.
7. At job boundaries, visual and printing parents check for a changed pointer.
   They validate it, retire the old native process before opening another, and
   pin the new process to an immutable manifest. Invalid/racing publications
   preserve the old process. Obsolete pending jobs become SUPERSEDED rather
   than spending retries on unavailable versions. Completed evidence, human
   choices and Inventory receipts remain unchanged.

## Resource and recovery limits

The local maintenance service is capped at one CPU and2GiB, with two public
image download slots and four starts per second. Native private-photo services
remain on the internal network. Maintenance has no photo input.

The opt-in loop persists its attempt time, normally runs daily, and reports its
next attempt. Restart respects that saved cadence. A provider failure waits
for the next maintenance pass; no hot retry loop powers through rate blocking.
It runs only while local Docker and the laptop are running; no Codex scheduled
task or production scheduler is installed by this Compose layer.

Generated cache cleanup retains the original baseline plus the current and two
recent index generations. Every public image is retained, including images
shared by newer generations. Old index manifests remain diagnostic records;
retired matrices are not loadable generations. Completed feature/download work
databases and temporary reuse metadata are released after publication. The two
recent provider sources remain; evaluation originals outside this maintenance
store are untouched. Cleanup only removes specifically named generated files
inside checked roots, never unknown files or entire directories. Open Windows
matrix mappings may defer cleanup.

Per-photo Scryfall metadata reconciliation continues to use the existing Card
table/shared cache. This service does not introduce another card database or
perform the separate bulk Card import. Strong automatic confirmation and the
remaining scale/accuracy gates are still independent #463 work.

## Verification

- Synthetic public-reference tests cover changed bytes, changed metadata,
  shared immutable files, model changes, interrupted feature batches, resume,
  provider failures, corruption, bounded cache cleanup and retained baseline.
- An unchanged-file test disallows all JPEG reads during a metadata-only refresh;
  modifying one of those files still rejects its reused digest.
- Native lifecycle tests cover invalid/racing publications, retirement before
  reopen and preserving the working process.
- Disposable PostgreSQL/core verification passes with owned cleanup. Immediate
  fixture claims use the database's observed clock because tests run on Windows
  against Linux PostgreSQL; production queue timing is unchanged.

Actual full-size refresh, worker handoff, final local browser/source provenance
and installed cadence evidence are recorded in the checkpoint and PR. Until
those complete, this batch remains a draft and no full-size efficiency or
recurring-operation claim is made.
