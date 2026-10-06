# Private correction photos

This batch implements capture and retention for recognition work under issue463.
It does not change rankings, independently verify labels, train models, share
photos outside the installation or promote a recognition policy automatically.

## Agreed defaults and scope

- Each owner starts with 64 GB (64,000,000,000 bytes). The application default
  `CORRECTION_LIBRARY_OWNER_LIMIT_GB` sets new accounts using whole decimal GB.
  An existing account's `limitBytes` is its explicit administrative override;
  changing the default never silently changes an existing override.
- Existing acquisition upload quotas remain separate. Preserved unique originals,
  reservations and saved evidence are counted against the library allowance.
  Small transactional events/evidence can exceed a full allowance to preserve
  accepted review history; original copies wait for room with pins intact.
- Prospective controls use cryptographic 200/10,000 draws at original upload
  admission, before any recognition outcome. The initial configurable cohort cap
  is 200 per owner, with no automatic daily reset or rotation. Selected upload
  reservations consume cohort positions even if never finalized. An upload replay
  keeps its original draw. Pre-existing originals are not retrospectively sampled.
- The user manages Unraid capacity. This library neither inspects the server nor
  introduces a free-space probe. Actual write failures keep originals pinned.

## Review and retention

Signed display identities bind the actor, owner, original digest/generation,
candidate/revision, ordered offered printings and source-job/output identities.
Browser drafts retain initial/current/edit identities and a bounded display
history, explicitly flagging truncation. The saved event distinguishes initial
agreement, alternatives/search, absent suggestions, later label changes,
metadata-only edits, pending withdrawal, automatic selection and unknown display
identity. An old client or invalid identity cannot fabricate known attribution;
its valid review still saves with an explicit unknown state.

Review history, independent example membership, source pin and outbox admission
share the ordinary review transaction. Exact lost-acknowledgement replay does not
create another event. Printing/finish/condition edits remain separate from
independent ground truth. Source-job snapshots are private allowlisted evidence,
explicitly partial for offline replay: this batch does not archive whole catalog,
model or index generations. Historical first publications remain unknown.

Raw bytes live independently under `UPLOADS_DATA_PATH/correction-library-v1`.
Deduplication is exact-byte and within one owner; physical example memberships
remain distinct. Temporary files contain new copied bytes, are flushed before
atomic publication, and are attached only under a current independent copy lease.
An attachment rollback can reuse a verified immutable destination on retry.
Cancellation of the acquisition batch does not cancel this queue.
Admissions rotate between owners using a persisted last-served turn, while
preserving FIFO order within an owner's eligible queue. A full allowance consumes
that owner's turn so another owner's smaller queue can continue. Worker restart
does not reset the rotation.

Normal expiry, expired Trash and pressure cleanup exclude pinned batches and
repeat that check under the source session lock before unlinking. Missing/corrupt
source bytes, permission failures, unavailable storage and full allowance never
mean preserved. The bounded worker retries; the scan screen and private library
show pending counts/bytes, oldest pending time and copy/allowance warnings.

## Owner controls

`Imports > Scan cards > Correction photos` provides paginated private examples,
explicit original viewing, label withdrawal and example removal with byte-impact
preview. Viewing is independent of the original batch's lifecycle. Every request
checks the current account/player and actual Admin Mode; cross-owner admin access
is audited. No keys or native filesystem paths are exposed.

Withdrawing a label retains evidence. Removing an example clears its label,
recognition evidence and review events, then records a minimal owner/photo
tombstone. Another physical membership can retain the same owner's shared raw
bytes. Final raw removal uses a durable deletion claim and retryable GC; another
owner's identical photo remains independent. Acquisition and Inventory remain
unchanged. Independent verification/exclusion, diagnostic clustering and
experiment screens belong to later phases.

## Backup and recovery

An active backup guard is created before the database dump and held through
appdata staging and archive publication. It blocks final raw GC and pin release;
a copy can complete while its pending source remains protected for that archive.
Temporary copy parts are excluded. Default uploads coverage contains both original
and library namespaces. Custom paths append uploads when needed and subsume
overlapping custom upload subdirectories, preserving valid restore mappings.

Restore runs in the existing fail-fast database replacement transaction. It retires
restored copy leases without consuming an attempt, rotates display signing keys,
retires archived backup guards and reapplies current deletion tombstones before
analysis can read restored records. Restoring an older pre-library archive keeps
removal intent for forward migration. Removed bytes can still exist inside old
archives until the existing `BACKUP_RETENTION_COUNT` / `BACKUP_RETENTION_DAYS`
policy removes those archives; removal does not edit an already-created archive.

A killed backup leaves its guard active intentionally. `npm run
backup:corrections:guards` lists guard IDs/times. Only after the operator verifies
the corresponding backup has stopped, run that command with
`-- --release=<guard UUID> --confirm-backup-stopped`. There is no age-based
automatic release that could race a slow active archive. Restoring a backup also
retires archived guards. Capture/review continue while destructive cleanup waits.

## Qualification status

Implementation is in progress and not loaded into the review Docker environment.
835 unit checks, typecheck, production build and thirteen client manifests passed.
Three direct file tests also passed. The new disposable
PostgreSQL/file fixture passed capture, replay/rollback, display ordering, owner
isolation/dedup, copy/quota/missing-source pins, backup guard, restored lease,
withdrawal/removal and older-restore tombstones. Full acquisition and shared-import
regressions passed in a disposable database (175.622 seconds). The final rerun with
expanded first-publication, review-history and deletion-resumption coverage passed
in 280.684 seconds; all owned fixtures/container/volume were removed. A later
full PostgreSQL/import run passed in 266.386 seconds including four uneven queues
of 1,500/3/2/2 pending photos, concurrent admissions, reconnects, per-owner FIFO and
quota-blocked rotation. Eight admissions took 520 ms in that disposable fixture.

`npm run verify:correction-recovery` passed real archive/restore and kernel storage
failure checks in an isolated empty database and bounded tmpfs. It kills the
actual worker after prepared bytes and after publication before database commit,
then verifies retry and stale-lease rejection. Real ENOSPC and unprivileged EACCES
retain reservations and every source pin; temporary cleanup removes expired parts
and preserves the live leased part. A post-dump copy hook proves source protection
through appdata staging. Original bytes and ordered event/evidence records survive
restore, keys rotate, and older-schema restore plus forward migration retains
removal tombstones. All original local runtime identities, mounts and limits
remained unchanged; only UUID-owned disposable resources were removed.

Cumulative images, desktop/phone browser checks and current-head CI remain
required. Delivery must update the backup service along with the six acquisition
services so the local backup utility uses the new guard protocol.
