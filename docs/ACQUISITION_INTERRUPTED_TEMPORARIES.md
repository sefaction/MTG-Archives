# Interrupted acquisition photo temporaries

The photo writer uses a synced UUID temporary and a hard link to publish an
immutable original or preview. Process death before `finally` can leave the
temporary name, including a readable alias after publication. Older retention
removed only original/preview names, so its successful purge marker could leave
those private bytes behind.

Normal committed, expired-Trash and pressure cleanup now discovers strict
writer-temporary names for the selected photo batch once, using a streaming
directory iterator. It removes those names under the existing session, pin and
expiry authority before marking the photo purged. Unknown names, other photo
IDs and directory/symlink targets are not traversed or swept. A selected unsafe
file or unlink failure leaves the photo unmarked for retry. No upload writer,
retention period, quota, correction policy, receipt or Inventory writer changes.

## Previously marked photos

Ordinary retention does not select an already-purged row. The explicit repair
command handles known old rows without creating a global deletion sweep. Select
one owner and at most 25 photo IDs, with the existing `DATABASE_URL` and absolute
private `UPLOADS_DATA_PATH` for the authorized target:

```sh
npx tsx scripts/repair-acquisition-photo-temporaries.ts --owner=OWNER --photo=UUID
```

The default previews aggregate eligibility/file counts and performs no deletion
or photo/Inventory row changes. Applying the same selection requires both
`--apply` and `MTG_PHOTO_TEMPORARY_REPAIR=1`. Installation-specific operational
authority remains governed by AGENTS.md; this PR runs only isolated local cases.

Repair rechecks the owner, run, purged marker and correction pins under the
session lock. It accepts an irreversible deleted session or an untrashed
committed source with its original purge deadline and aged receipt. Active,
foreign, pinned and not-yet-expired sources stay untouched. Replay is harmless;
failures are reported for the same selected IDs to be inspected/retried. The
operator must supply known IDs; no claim is made that historical installations
were searched or that their old files were repaired.

## Qualification

The opt-in `verify-acquisition-interrupted-storage.ts --verify` requires a local
disposable `acquisition_*` database and the existing pilot opt-in. Actual owned
children execute the production writer and receive SIGKILL at the real link
boundary, before or after publication. It checks non-READY/no-derived state,
same-identity recovery/finalize replay, expiry, failed-unlink retry, explicit
legacy preview/apply/opt-in/owner guards, unchanged neighboring originals and
Inventory/receipts. Committed/Trash correction pin and backup races and pressure
cleanup include real temporary aliases. All initial public-table fingerprints
must be restored; owned files are removed only after terminal child and database
restoration checks. Primary and cleanup failures remain distinct.

File regressions cover raw/preview aliases, unpublished bytes, exact names,
malformed/foreign names, symlinks/directories, batch discovery and actual process
death. Linux image/source bindings, executed counts, original failure, fixture
corrections and exact-head CI are recorded on the PR. This does not establish
power-loss durability, every concurrent writer schedule, independent recognition,
production deployment or broad #305/#310 acceptance.
