# Isolated backup/restore drill (#237)

This is an opt-in laptop exercise, not production recovery. It uses the real application's `createBackup` / `restoreBackup` functions and current local snapshot, with a separate disposable PostgreSQL 16 target. It never restores into the running web database.

## Run

Build the cumulative local image with all three review overlays, then from this repository:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npx.cmd tsx scripts/verify-backup-restore.ts --run
```

Stop other MTG tests and avoid editing the app during capture. Other projects need not stop, although heavy load affects timing. The source container must be the healthy `mtg-archives-web-1` Compose service with backups bound to this repository's `.local-data/backups`. The runner rejects a different source/mount.

If capture completed but a later drill step was interrupted, use `--run --reuse=<UUID>` to restore the explicitly selected private capture again into a **new** isolated target. It never reuses an old database. UUID paths are restricted to the same repository backup root; a complete `evidence.json` is required. The disposable runner receives the current checked-out drill helper, while restoration itself uses the application's image/library. Rebuild before testing changed application restore code.

## Isolation and evidence

- Writes a new private backup/evidence directory under `.local-data/backups/drill-<UUID>`, with retention disabled for that capture. Existing backups and the running snapshot are not removed.
- Checks before/after source database and file digests; concurrent source changes make the drill fail rather than validate incomparable snapshots.
- Creates a unique internal Docker network, fresh database and one-shot restore container. No host ports, external routing, source database credentials, writable source mounts or app/notification/pricing entrypoints are used. The archive mount is read-only.
- Verifies dry-run leaves the empty database and appdata sentinels unchanged. Explicit forced restore must replace the sentinels only in disposable `/drill/restored` targets.
- Compares full row-content digests and counts for all nonvolatile public tables (including users/owners, exact inventory, decks, trades, League, imports and migrations), physical-copy totals, and recursive file/directory SHA-256 maps for all four appdata roots. Checks Prisma migration status.
- Notification, delivery job/attempt and wishlist-digest activity tables are included by the actual dump/restore but excluded from quiescent digest comparison because the normal source worker updates them asynchronously. This is an explicit coverage limit.
- The legacy `CardPriceSnapshot` cache remains in some primary snapshots despite the separate pricing database architecture. It is included in the archive and compared by row count only; sorting millions of full-row hashes is not proportionate for a refreshable cache. All authoritative tables retain full-content digest checks. The initial diagnostic full-cache hash was cancelled before backup creation to avoid monopolizing laptop disk I/O.
- Removes only UUID-labeled drill containers, their disposable database/appdata and the internal network. The private source archive/evidence remain for local recovery/inspection; they are ignored by git. Never upload them to GitHub or Foundry.

## Defects found and fixes under validation

- #246: the floating Alpine image installed PostgreSQL 18 clients while the Compose databases use PostgreSQL 16. The first real archive was dumped from 16.15 by 18.4 and its restore failed. Pin the supported client major and reject mismatched backup creation; retain old archives privately for compatibility assessment rather than rewriting them.
- #245: validation previously stopped at the manifest before replacing the schema. The fix preflights archive entries, complete dump payload, server compatibility and all explicitly configured appdata targets; it never falls back to archive-provided source paths. Schema replacement plus SQL loading now share one fail-fast transaction. The drill adds missing/corrupt-dump canaries and a deliberately failing SQL check constraint to verify rollback after schema replacement begins. Filesystem copies follow database commit and are not cross-resource atomic.
- The first complete capture took about 63 seconds and produced an 88 MB compressed archive. Initial diagnostic runs are not passing recovery evidence. Results with corrected clients and safety guards will be recorded below and in the PR.

Implementation references: [PostgreSQL dump compatibility](https://www.postgresql.org/docs/16/app-pgdump.html) and [psql transaction behavior](https://www.postgresql.org/docs/16/app-psql.html). PostgreSQL explicitly does not guarantee loading newer-client dump output into older servers, even when the source server was older.

## Recovery boundaries and remaining limits

Development check on 2026-09-20 passed against the corrected working library: 48 authoritative table content digests plus the legacy price-cache count, 12,477 physical copies, four appdata roots and 21 file/directory entries matched. Capture took 65.5 seconds (87,664,740 bytes); restore including preflight took 93.0 seconds. Dry-run sentinels, missing/corrupt dump preservation and a real check-constraint failure rollback all passed. The disposable resources were removed and the compatible archive retained privately. This was explicitly a development-library run; final rebuilt-image evidence is required before PR readiness.

The downloadable application archive is **not** a whole-installation backup. It excludes the separate pricing PostgreSQL database, deployment configuration/credentials and the webhook master encryption key in `BACKUP_DIR/.system-secrets`. Preserve those separately in protected operator backups. Without the original key, restored saved webhook destinations cannot be decrypted and must be recreated. The drill deliberately does not start notification delivery or test external providers.

Appdata file copying and the database dump are not one cross-resource transaction. The drill detects changes around its capture; production recovery planning needs a quiescent maintenance window or coordinated snapshots. Restore replaces the configured database schema and included appdata roots, so operators must validate exact targets, keep a fresh backup and use the explicit confirmation gate. Never test production recovery by restoring over live data.

The current format has no cryptographic authenticity guarantee. Use only trusted private archives; this drill does not establish that arbitrary uploaded archives are safe. End-to-end restored-app browser acceptance and key recovery are separate from database/file equality.
