# Pricing archive activation gate

The existing archive maintenance profile remains disabled by default. This
change introduces `PRICING_ARCHIVE_PRODUCTION_ENABLED=1` as a separate apply
authorization from `MTG_LOCAL_PILOT_TEST=1`. Exactly one mode must be set for
any archive write. Production mode also requires the maintenance opt-in, a
configured backup root, a recovery-copy directory and a separate verification
database URL. The production recovery directory must be the
`BACKUP_DIR/pricing-recovery` sibling chosen for MTG Archives backups. Raw
retention additionally requires its own opt-in. The Pricing
worker pauses imports in the 2–5 a.m. America/Chicago window only when the
retention, maintenance and one-mode settings are complete.

## Evidence and remaining review

- The local four-owner full-size retention load drill in PR #392 measured
  Collection p95 of 1,690 ms during the pass versus 1,630 ms idle, with Market,
  Data and Dashboard responsive. The current-schema recovery packages in PR
  #414 were copied to the selected MTG Archives Unraid backup subtree, read
  back, audited and restored into a separate local verifier. These are local
  load and recovery proofs, not production load tests.
- The user directs testing to the local install. Do not start drill containers,
  restores or load generation on the Unraid production host. No production
  archive apply or scheduler has been authorized or launched by this change.
- A production rollout still needs a reviewed image, configured
  `BACKUPS_DATA_PATH`, `PRICING_RECOVERY_COPY_DIR` under the MTG Archives backup
  root, a distinct `PRICING_VERIFY_DATABASE_URL`, free-space and recovery
  checks, import/maintenance window observation, and an operator-reviewed
  rollback plan. Do not infer those runtime settings from this repository.
- The repository's `docker-compose.unraid.flat.yml` is a separate deployment
  option and does not define the archive maintenance or verifier services.
  Determine which Compose form production actually uses before preparing an
  activation change. This PR updates the layered `docker-compose.yml` path
  only; it does not make the flat file eligible for archive maintenance.

## Rollout sequence after separate production authorization

1. Keep `PRICING_ARCHIVE_PRODUCTION_ENABLED=0`,
   `PRICING_ARCHIVE_MAINTENANCE_ENABLED=false` and
   `PRICING_RAW_ARCHIVE_RETENTION_ENABLED=0` while deploying the reviewed image.
   Leave `MTG_LOCAL_PILOT_TEST=0` in production.
2. Confirm the selected application and Pricing backup subdirectories and the
   independent verifier are reachable from the maintenance profile. Inspect
   read-only backlog and raw-retention plans. Confirm the previous local
   current-schema restore and full-size copied-package evidence still applies
   to the deployed image and schema.
3. After the user approves production activation separately, enable the
   maintenance profile and production opt-in for queued older corrections.
   Observe one complete 2–5 a.m. Central window, its copied package receipts,
   backlog and normal application health before considering raw deletion.
4. Enable the raw-retention opt-in only after that observation. It handles at
   most one oldest eligible date per pass, requires 85 minutes of remaining
   window, pauses new imports and verifies a separate recovery copy before
   changing live raw history. Keep the recovery-package restore and rollback
   procedure available for each operation.

Setting an opt-in in a Compose environment file alone is not evidence that
the job is active. Verify the running container configuration and logs after
deployment. Issue #330 remains open until the approved production operation
and recovery evidence are complete.
