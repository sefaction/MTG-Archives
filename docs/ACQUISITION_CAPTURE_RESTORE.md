# Durable upload acknowledgement across backup/restore — #305

## Scope and coverage map

The agreed remaining P3 requirement is capture-consistent backup/restore with preserved images, review/receipt/pending state and safe retry. This batch does not add online backup support, change quiescence requirements, or qualify power-loss durability, physical scanners or mobile capture. It uses only disposable databases and synthetic files.

| Existing evidence | Covered boundary | Remaining composed case |
| --- | --- | --- |
| `verify-acquisition-storage-boundaries.ts`, #892 | Actual upload failures, same-identity retry/ACK replay and partial purge recovery | No archive or restored installation |
| `verify-restore-worker-archive.ts`, #652 | Actual backup/dry-run/forced restore, live worker claims and restore fences | No durable unacknowledged photo retry through restored route |
| `verify-backup-restore-container.ts`, #237/#639 | Quiescent capture, full DB/file comparison, archive validation, isolated restore and credential fencing | Existing composed photo/review/receipt retry evidence must be inspected, not inferred |
| `verify-acquisition-retention-pin-races.ts`, #900 (review-ready) | Purge/pin/publication/release versus backup guards | No full archive/restore; its independent review status remains unchanged |
| `verify-acquisition-commit.ts` | Explicit subset commit, pending conservation, provenance, rollback and idempotent receipt | No archive or credential reset between original request and retry |

The selected case finishes a real upload route, deliberately withholds consumption of its acknowledgement, captures a quiescent source while no file/DB writer runs, and restores into a distinct empty target with separate file roots. Old authentication must fail, fresh owner authentication must retrieve exact originals and retry the same upload identity without new photos/candidates/jobs/Inventory. A changed payload and a different owner must fail without writes. A later different physical slot containing identical bytes must remain a distinct physical copy. Existing explicit commit and pending records must survive; replay must not duplicate Inventory.

## Current status

Author qualification passes on `codex/acquisition-capture-restore-305`, based on main `339188b0d3aca0197a0a3b0c086c723728d14ab4`. The PR owns required final-head CI and review status. This completes one composed software acceptance case; #305/#302 remain open for broader acceptance. No merge, deployment or user acceptance is implied.

## Actual qualification, October 23, 2026

`scripts/verify-acquisition-capture-restore.ts` passed twice against real PostgreSQL 16, actual JPEG/PNG/WebP upload routes, `pg_dump`/archive creation, dry-run and forced restore. The final run took 3,626 ms and produced a 60,410-byte archive with SHA-256 `8ac0d3820d0a76989fd26f9899f69690b0737f8da4e6326dd3b97e54cfd853e7`.

- Every row and field in all 84 public tables is compared, alongside every appdata file byte. The deliberately new backup guard is independently checked; restored authentication sessions are revoked, the exact archived guard is released, and the correction display credential rotates. Only those explicit transformations are normalized; all other fields remain compared.
- Three validated originals, one committed physical copy, one saved pending copy and the original commit receipt survive. Two replays of the unconsumed upload acknowledgement return the original identity without writes. The receipt replay adds no Inventory. A changed payload returns 409; stale credentials and a different owner return 403. The authenticated owner retrieves exact private bytes with `private, no-store` caching.
- A later new slot with identical WebP bytes creates a distinct photo while Inventory remains one. The original source's rows/files remain unchanged after isolated restore and target retries.

The fixture invokes the real route/API/store code. Only Next's ambient cookie provider is adapted to real stored-session tokens. Leaving the returned Response body unconsumed models the post-finalization/pre-client-acknowledgement boundary; it is not a real browser network-loss or physical phone/scanner test. All mutation workers are idle during capture; this does not establish online backup support or power-loss durability.

The runtime reused an existing Linux application image solely for installed dependencies and archive tools. Application sources were a Git archive of `a01a370298d992af91a09c2f09fb348f41d0b56a` (main339188b plus the initial test/report) with the final test overlaid. Tested script SHA-256 is `358b95fe79e090c3c2a8ad2ebdc153935dd205ba7e9f9106ac4a27444bc4ce6b`. The reused client contains additional whole-deck models; the exercised 84-table schema matches main exactly. The dedicated CI job performs a fresh lockfile install/client generation/migration against this branch and repeats the actual control independently of that reused client.

## Failures and limits retained

The first setup guard incorrectly required migration-seeded LocationType to be empty; it now requires the exact eight migration seed names. The first upload attempt then correctly refused a 128 MiB temporary filesystem because the existing free-space floor is 2 GiB. Only the two exact-owned disposable databases were reset, and the runner used its private disk; the product storage guard was unchanged. Both original failures and the resulting zero-ready/zero-Inventory state are retained privately.

The unchanged general recovery drill was also executed separately and failed solely because its before/after comparison treats its own new `CorrectionBackupGuard` row as source corruption. It emitted no qualified evidence. Independently actionable [#922](https://github.com/sefaction/MTG-Archives/issues/922) tracks that repair; this PR does not repair or claim qualification of that older verifier. Its later restore projections still require investigation.

## Reproduction and ownership

Use two newly created disposable PostgreSQL databases, `acquisition_capture_source305` and `acquisition_capture_restore305`, on the same local server/user. Migrate only the source; the restore target must have no public tables. Set `DATABASE_URL`, `CAPTURE_RESTORE_DATABASE_URL`, `MTG_LOCAL_PILOT_TEST=1`, and `MTG_CAPTURE_RESTORE_FIXTURE=1`, then run `npx tsx scripts/verify-acquisition-capture-restore.ts` with matching PostgreSQL archive tools available. The script rejects other database identities and a populated fixture. The parent owns removing both databases and the private temporary files after recording results. CI's disposable service/runner provides that lifetime.

Desktop evidence and the ownership/cleanup journal remain local. The temporary runner had no published ports, a 2 GiB memory limit and separate file roots. Terminal cleanup verified its immutable identity, absence of test children and database clients, preserved the three small archive/failure records, then removed only that runner and the two newly created databases. The private environment file was deleted and the exact-owner runtime claim released. All 84 original-review table fingerprints match the saved baseline; current review apps, images and volumes remain. Exact-head CI is recorded on the PR separately.
