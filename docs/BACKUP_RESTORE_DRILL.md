# Isolated backup/restore drill (#237)

## Restored acquisition worker claims (#652)

The forced restore transaction now revokes both restored credentials and all
RUNNING acquisition-processing/catalog publication claims before committing the
replacement schema. Processing attempts with remaining retries become PENDING;
exhausted attempts become FAILED with `RESTORE_INTERRUPTED`. Attempts, limits,
inputs, outputs, identities, saved reviews and immutable Inventory receipts remain.
Completed/non-running jobs and catalog results are unchanged. Cancelled, trashed,
deleted and reviewed sessions retain their ordinary admission restrictions.

Fresh captures include full-field expected projections for this transformation.
Originally RUNNING row identities are recorded privately; only their intended
status/lease/error/time fields are normalized, and actual cleared leases and
statuses are checked independently. Older captures without this evidence must be
recaptured for the full drill. This does not qualify scanner epochs, cross-store
atomicity, every host/storage interruption, or automatic physical resumption.

The disposable acquisition suite includes stale heartbeat/completion/failure and
held catalog-provider publication, retry/exhaustion, fresh work, rollback,
idempotence, frozen human review, non-running controls and quoted legacy schemas.
An incompatible present table causes transaction failure rather than partial
credential revocation. Missing legacy tables are tolerated.

For a prepared local web image, run
`npx tsx scripts/verify-restore-worker-local.ts mtg-archives-web:restore-worker-claims`.
This creates UUID-labeled PostgreSQL and app containers on an internal network,
with no source mounts or host ports, migrates the fixture, and invokes the actual
backup/dry-run/forced-restore library with eight unexpired processing claims and
one held catalog claim. It then verifies field projections and publication guards
and removes the exact owned containers, anonymous volume and network. It never
restores the primary local snapshot. Its private cleanup journal remains under
`.local-data/restore-workers-<UUID>.json` for interruption recovery.

October 5 verification: complete acquisition/import suites passed; core
verification passed all 820 units plus generation/typecheck/build/manifests. The
final installer-enforced image passed the miniature forced restore in 2,174 ms,
with all eight processing claims and one catalog claim live immediately before
restore. Desktop 1366px and phone 320px backup-page checks passed with owned admin
accounts, then accounts were removed; screenshots were inspected. The initial UI
harness navigated before Admin Mode submission completed and failed both cases;
waiting for the resulting Exit Admin Mode control corrected the harness. Earlier
sandbox ownership/file-lock verification attempts are not counted as passes.
This batch requires individual PR approval before merge.

This is an opt-in laptop exercise, not production recovery. It uses the real application's `createBackup` / `restoreBackup` functions and current local snapshot, with a separate disposable PostgreSQL 16 target. It never restores into the running web database.

## Run

Build the cumulative local image with all three review overlays, then from this repository:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npx.cmd tsx scripts/verify-backup-restore.ts --run
```

Stop other MTG tests and avoid editing the app during capture. Other projects need not stop, although heavy load affects timing. The source container must be the healthy `mtg-archives-web-1` Compose service with backups bound to this repository's `.local-data/backups`. The runner rejects a different source/mount.

For a local maintenance capture with live scanner heartbeats, use `--run --quiesce`. Finish/drain or cancel all scanner runs first. This optional mode checks settled transfers before mutation and again after pausing web: DRAINED, CANCELLED_BEFORE_START, or ERROR with a persisted finish outcome. An ERROR with a SQL/JSON null outcome, legacy CANCELLED, queued/started or reconciliation state still requires recovery. The check shares the scanner's settlement policy. The mode stops only the known MTG background worker roles that were running, briefly pauses the website, and captures through a helper using the loaded image. All four source file mounts are read-only; only its new private archive directory is writable. The website is unavailable during capture. The source database stays running and is never a restore target. Host scanner helpers are not stopped and no driver/motor operation is invoked.

Exact original service IDs/states and maintenance phase are journaled in that private directory's `service-state.json` before mutations. Normal success or failure resumes web and attempts every intended worker restoration before the separate isolated restore begins. If the host process/laptop is interrupted, inspect the journal and live Docker identities before resuming those exact MTG services; do not assume cleanup ran or start a replacement container under an old name. A pre-paused service rejects this mode. `--quiesce` cannot be combined with archive reuse.

The October 4 settlement repair under [issue639](https://github.com/sefaction/MTG-Archives/issues/639) / [draft642](https://github.com/sefaction/MTG-Archives/pull/642) passed real isolated PostgreSQL status and SQL/JSON-null cases, unchanged-row/zero-image/zero-Inventory assertions and the actual capture orchestrator with a rejected preflight and no archive/capsule/service mutation. The full isolated acquisition/import/core checks passed (815 units); all three implementation-head CI checks passed. The rebuilt local image's 549 inputs matched the source manifest, and read-only `check-capture` accepted the actual settled scanner runs. Four owned dashboard/count/refill/section-series browser cases passed in 55.4 seconds, with desktop/phone screenshots inspected. Existing Inventory, user batches and all 97 retained originals stayed unchanged; all 12 other service identities/images were preserved. No actual backup, service quiescence, restore or physical scanner operation was performed for this repair. Broader restore epoch/credential/lease fencing remains separate under #310.

Capture mismatch diagnostics identify changed table names/counts/content-change flags in `capture-failure.json`, without row data or fingerprints. A failed capture remains unqualified and has no successful `evidence.json`; it must not be reused as passing evidence. No scanner/auth table is excluded to accommodate heartbeats.

If capture completed but a later drill step was interrupted, use `--run --reuse=<UUID>` to restore the explicitly selected private capture again into a **new** isolated target. It never reuses an old database. UUID paths are restricted to the same repository backup root; a complete `evidence.json` is required. The disposable runner receives the current checked-out drill helper, while restoration itself uses the application's image/library. Rebuild before testing changed application restore code.

Successful application restore clears restored website sessions and scanner
pairing codes and revokes restored scanner connections inside the database
replacement transaction. Sign in again and explicitly pair the helper. User
passwords/roles, Inventory, receipts, reviews, originals and scanner history are
retained. Dry-run does not change credentials, and database failure rolls the
credential changes back with schema/data replacement. Application archives that
predate the authentication/scanner tables remain supported.

Fresh drill evidence records the ScannerAgent rows with every field except the
intentional revokedAt transformation. After restore, all agents must be revoked
and that projection must match. Website sessions and pairing codes must be empty;
all other authoritative table/file comparisons retain their existing rules. A
drill capture predating this credential-policy evidence requires a fresh qualified
capture; that qualification restriction does not prevent ordinary application
restore of its archive. Scanner epoch rotation, stale acquisition lease handling
and interrupted cross-store recovery remain separate requirements under #310.

The October 4 credential-fence implementation passed the full isolated
acquisition/import/core checks (815 units), all three implementation-head CI
checks, and four local dashboard/count/refill/Stop browser cases in 53.9 seconds.
The rebuilt image matched all 550 runtime inputs. Real PostgreSQL cases verified
old credentials refused, fresh sign-in/pairing accepted, transaction rollback,
idempotence, unchanged user/agent metadata, quoted legacy schemas and no physical
runs or Inventory effects.

A fresh quiescent capture of the actual local snapshot passed source database
and file conservation: 70 compared tables, 12,495 physical copies and a
3,303,416,396-byte archive; backup creation took 444.3 seconds. Original service
identities/images/states were restored before the isolated restore. The combined
restore command failed at approximately its 15-minute host limit while the last
observation showed PostgreSQL building indexes. The wrapper retained only a
generic Docker-step failure, so timeout is inferred from timing rather than a
preserved error code. Dry-run and negative controls had completed, but the full
restored-content/authentication/file gate did **not** finish and remains failed.
All owned containers/network were removed, and source authentication,
Inventory, actual user batches and all 97 retained originals remained unchanged.
This is not full restore qualification; preserve the failure and repair bounded
stage execution/diagnostics before a new isolated attempt.

The follow-up under [issue646](https://github.com/sefaction/MTG-Archives/issues/646)
splits validation/negative controls and forced restore/content verification into
two sequential commands in the same UUID-owned target. Each command retains the
900-second limit. An idle Node process keeps that disposable container's file
layer between commands; it does not run the website or any worker. Apply requires
the validation checkpoint for the exact capture evidence, an empty target
database and unchanged appdata sentinels. It cannot skip the negative controls or
reuse an earlier restored database. Sanitized Docker diagnostics retain timeout
codes and the active phase without printing command arguments or credentials.
The original combined-command failure remains failed. A new complete actual
attempt and owned cleanup are required for qualification.

The fresh retry in [draft647](https://github.com/sefaction/MTG-Archives/pull/647)
at implementation `f305e12` subsequently **passed** with actual terminal exit 0,
using a new isolated target and the qualified read-only capture. Both phases
completed within their unchanged 900-second limits. Validation exercised the
actual apply entry point with missing and changed checkpoints, then passed
dry-run sentinels, missing/corrupt dump preservation and real SQL rollback with
the trigram index retained. Forced application restore took 510.5 seconds before
the final comparisons. The final 70-table comparison policy, 12,495-copy total,
four data roots and all 2,095 file/directory entries matched; migrations were
current. The three intentional authentication transformations cleared 989
website sessions and four pairing codes, and revoked all eight retained agents
while preserving every other agent field. Other authoritative tables retain full
content checks; four volatile notification tables remain excluded and the legacy
price cache remains count-only, as documented above.

The unchanged credential-fence library from [draft645](https://github.com/sefaction/MTG-Archives/pull/645)
was tested through the rebuilt image, with no working-library override. All 550
runtime inputs matched source. Full isolated acquisition/import/core checks
(817 units) and all three implementation-head CI checks passed for the harness
batch. Both owned containers and the internal network were removed. The original
website's authentication, Inventory, user batches, all 97 retained originals and
all 13 service identities/images/running states were conserved through the retry;
the physical helper remained idle. The earlier combined-command run remains
failed. This qualifies the bounded restored-authentication/content case, not
scanner epoch rotation, stale acquisition lease retirement, interrupted
cross-store restoration or a restored-app browser release under #310. Each draft
still requires individual merge approval; no production operation occurred.

## Isolation and evidence

- Writes a new private backup/evidence directory under `.local-data/backups/drill-<UUID>`, with retention disabled for that capture. Existing backups and the running snapshot are not removed.
- Checks before/after source database and file digests; concurrent source changes make the drill fail rather than validate incomparable snapshots.
- Creates a unique internal Docker network, fresh database and one-shot restore container. No host ports, external routing, source database credentials, writable source mounts or app/notification/pricing entrypoints are used. The archive mount is read-only.
- Verifies dry-run leaves the empty database and appdata sentinels unchanged. Explicit forced restore must replace the sentinels only in disposable `/drill/restored` targets.
- Compares full row-content digests and counts for all nonvolatile public tables (including users/owners, exact inventory, decks, trades, League, imports and migrations), physical-copy totals, and recursive file/directory SHA-256 maps for all four appdata roots. Checks Prisma migration status.
- Notification, delivery job/attempt and wishlist-digest activity tables are included by the actual dump/restore but excluded from quiescent digest comparison because the normal source worker updates them asynchronously. This is an explicit coverage limit.
- The legacy `CardPriceSnapshot` cache remains in some primary snapshots despite the separate pricing database architecture. It is included in the archive and compared by row count only; sorting millions of full-row hashes is not proportionate for a refreshable cache. All authoritative tables retain full-content digest checks. The initial diagnostic full-cache hash was cancelled before backup creation to avoid monopolizing laptop disk I/O.
- Removes only UUID-labeled drill containers, their disposable database/appdata and the internal network. The private source archive/evidence remain for local recovery/inspection; they are ignored by git. Never upload them to GitHub or Foundry.

## Defects found and verified recovery guards

- #246: the floating Alpine image installed PostgreSQL 18 clients while the Compose databases use PostgreSQL 16. The first real archive was dumped from 16.15 by 18.4 and its restore failed. Pin the supported client major and reject mismatched backup creation; retain old archives privately for compatibility assessment rather than rewriting them.
- #245: validation previously stopped at the manifest before replacing the schema. The fix preflights archive entries, complete dump payload, server compatibility and all explicitly configured appdata targets; it never falls back to archive-provided source paths. Schema replacement plus SQL loading now share one fail-fast transaction. The drill adds missing/corrupt-dump canaries and a deliberately failing SQL check constraint to verify rollback after schema replacement begins. Filesystem copies follow database commit and are not cross-resource atomic.
- The first complete capture took about 63 seconds and produced an 88 MB compressed archive. Initial diagnostic runs are not passing recovery evidence. Results with corrected clients and safety guards will be recorded below and in the PR.

Implementation references: [PostgreSQL dump compatibility](https://www.postgresql.org/docs/16/app-pgdump.html) and [psql transaction behavior](https://www.postgresql.org/docs/16/app-psql.html). PostgreSQL explicitly does not guarantee loading newer-client dump output into older servers, even when the source server was older.

## Recovery boundaries and remaining limits

Development check on 2026-09-20 passed against the corrected working library: 48 authoritative table content digests plus the legacy price-cache count, 12,477 physical copies, four appdata roots and 21 file/directory entries matched. Capture took 65.5 seconds (87,664,740 bytes); restore including preflight took 93.0 seconds. Dry-run sentinels, missing/corrupt dump preservation and a real check-constraint failure rollback all passed. The disposable resources were removed and the compatible archive retained privately. This was explicitly a development-library run; final rebuilt-image evidence is required before PR readiness.

Final rebuilt-image verification subsequently passed without a library override (image `sha256:cac9e88d502bcbc46776769a6a7ebfd47ad83a8d66be989e2f500be0c717a1e6`, application `0acccf6`). The same 49 table comparisons, copy total and appdata map matched; all dry-run, malformed-payload and real SQL rollback controls passed, and migrations were current. Restore took 144.9 seconds under laptop load. Scoped disposable resources were cleaned, and private evidence stayed local. Log: `test-results/recovery-image-drill.log`.

The downloadable application archive is **not** a whole-installation backup. It excludes the separate pricing PostgreSQL database, deployment configuration/credentials and the webhook master encryption key in `BACKUP_DIR/.system-secrets`. Preserve those separately in protected operator backups. Without the original key, restored saved webhook destinations cannot be decrypted and must be recreated. The drill deliberately does not start notification delivery or test external providers.

Appdata file copying and the database dump are not one cross-resource transaction. The drill detects changes around its capture; production recovery planning needs a quiescent maintenance window or coordinated snapshots. Restore replaces the configured database schema and included appdata roots, so operators must validate exact targets, keep a fresh backup and use the explicit confirmation gate. Never test production recovery by restoring over live data.

The current format has no cryptographic authenticity guarantee. Use only trusted private archives; this drill does not establish that arbitrary uploaded archives are safe. End-to-end restored-app browser acceptance and key recovery are separate from database/file equality.
