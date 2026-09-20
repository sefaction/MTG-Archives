# Isolated backup/restore drill (#237)

This is an opt-in laptop exercise, not production recovery. It uses the real application's `createBackup` / `restoreBackup` functions and current local snapshot, with a separate disposable PostgreSQL 16 target. It never restores into the running web database.

## Run

Build the cumulative local image with all three review overlays, then from this repository:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npx.cmd tsx scripts/verify-backup-restore.ts --run
```

Stop other MTG tests and avoid editing the app during capture. Other projects need not stop, although heavy load affects timing. The source container must be the healthy `mtg-archives-web-1` Compose service with backups bound to this repository's `.local-data/backups`. The runner rejects a different source/mount.

## Isolation and evidence

- Writes a new private backup/evidence directory under `.local-data/backups/drill-<UUID>`, with retention disabled for that capture. Existing backups and the running snapshot are not removed.
- Checks before/after source database and file digests; concurrent source changes make the drill fail rather than validate incomparable snapshots.
- Creates a unique internal Docker network, fresh database and one-shot restore container. No host ports, external routing, source database credentials, writable source mounts or app/notification/pricing entrypoints are used. The archive mount is read-only.
- Verifies dry-run leaves the empty database and appdata sentinels unchanged. Explicit forced restore must replace the sentinels only in disposable `/drill/restored` targets.
- Compares full row-content digests and counts for all nonvolatile public tables (including users/owners, exact inventory, decks, trades, League, imports and migrations), physical-copy totals, and recursive file/directory SHA-256 maps for all four appdata roots. Checks Prisma migration status.
- Notification, delivery job/attempt and wishlist-digest activity tables are included by the actual dump/restore but excluded from quiescent digest comparison because the normal source worker updates them asynchronously. This is an explicit coverage limit.
- Removes only UUID-labeled drill containers, their disposable database/appdata and the internal network. The private source archive/evidence remain for local recovery/inspection; they are ignored by git. Never upload them to GitHub or Foundry.

## Recovery boundaries

The downloadable application archive is **not** a whole-installation backup. It excludes the separate pricing PostgreSQL database, deployment configuration/credentials and the webhook master encryption key in `BACKUP_DIR/.system-secrets`. Preserve those separately in protected operator backups. Without the original key, restored saved webhook destinations cannot be decrypted and must be recreated. The drill deliberately does not start notification delivery or test external providers.

Appdata file copying and the database dump are not one cross-resource transaction. The drill detects changes around its capture; production recovery planning needs a quiescent maintenance window or coordinated snapshots. Restore replaces the configured database schema and included appdata roots, so operators must validate exact targets, keep a fresh backup and use the explicit confirmation gate. Never test production recovery by restoring over live data.

The current format has no cryptographic authenticity guarantee. Use only trusted private archives; this drill does not establish that arbitrary uploaded archives are safe. End-to-end restored-app browser acceptance and key recovery are separate from database/file equality.
