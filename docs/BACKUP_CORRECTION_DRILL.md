# Correction lifecycle in the general recovery drill — #922

## Problem and repair

The source comparison treated the guard created and released by `createBackup()` as corruption, so a settled source produced an archive but no qualified evidence. The original unchanged CLI failure is retained with #922: only `CorrectionBackupGuard` changed, from one row to two. That capture result did not establish any later restore behavior.

Capture now checks every old guard field and permits exactly one new guard created/released during that operation. The same full guard identity must survive archive restore. Every other source table retains its existing raw comparison. Restore uses new, versioned correction evidence for the exact existing SQL fence: display credential rotation, interrupted correction-outbox lease invalidation, unreleased guard release, reapplication of removal tombstones, associated evidence/event removal and exact account-byte recomputation. Every other column, including future columns, remains in the full-row hash.

PostgreSQL hashes full JSONB rows before aggregating their small digests. Private labels, evidence payloads and other large row contents stay in the database; only hashes and lifecycle identity metadata enter the evidence. Actual new credentials must differ from the captured hashes, have the expected format and remain distinct. Restore-assigned timestamps must belong to the actual restore operation and its one transaction. Historical released timestamps remain exact. Correction tables leave the general comparison only after their full projections pass; none is simply ignored.

Captures without the new projection contract require fresh capture before restore validation. The host restore runner copies the main helper and both projection modules together. Existing quiescence, isolated target, credential/scanner/worker fences, negative validation checkpoint, timeouts, rollback and retention behavior remain authoritative. No application writer, schema or retention policy changes.

## Actual author qualification, October 23, 2026

`verify-backup-correction-drill.ts` runs the actual general CLI in capture, restore-validate and restore-apply modes against two new PostgreSQL 16 databases. The final run took 7,286 ms: backup 270 ms, forced restore 1,667 ms, archive 53,534 bytes/SHA-256 `5930f6d8de0fb3889ee8efbb4f6035245109b6f65322fa48da5343bb0014a961`.

- The 84-table migrated fixture contains two correction accounts, one interrupted correction claim plus unchanged pending/completed controls, an interrupted and an already released historical guard, saved labels/metadata, retained and removed examples/evidence/events/pins, three physical Inventory copies, three JPEG/PNG/WebP originals and an unrelated import. All eight correction tables receive a fixture-only future JSONB column to prove field completeness; no checked-in schema is changed.
- Actual `pg_dump` wrappers deliberately mutate a Player field and private original bytes after the real SQL dump and before backup completion. Both capture attempts fail at the expected database/file comparison and emit no qualified evidence.
- The exact settled archive then passes dry-run and actual forced restore. Missing/corrupt dump and real SQL-load failure preserve the canary, trigram index and destination file sentinels; missing/changed validation checkpoints refuse apply. Website sessions/pairings clear, scanner agents revoke, and the correction projection passes. Legacy correction evidence refuses before changing the empty target.
- Sixteen real SQL mutation controls fail: future-column changes in each of eight correction tables, an unrelated account field, missing/extra rows, stale lease authority, the original display key, duplicate display keys, stale restore time and changed historical guard release time. Each negative transaction rolls back and all84target-table fingerprints return to their pre-negative values. All84source-table fingerprints and original bytes remain unchanged through isolated restore/target negatives.
- Sixteen focused lifecycle/evidence/quiescence/isolation tests, final typecheck, workflow parsing and whitespace checks pass. Required final-head CI and live review state are recorded on the PR.

The general drill's existing limits remain explicit: four volatile notification tables are outside its content comparison, and legacy `CardPriceSnapshot` uses row count only. The reported80compared tables do not mean84full-content comparisons. The fixture's full84table comparisons prove source preservation and exact rollback of its own target negatives. Existing processing/catalog-worker projections run unchanged; this new fixture has zero processing/catalog claims and one running correction claim. Prior nonzero worker-claim qualification remains separate.

## Original UTC qualification source binding and limits

Base application/library sources are main `3b06f2089d9f017bcc1ed5952825a6497554a182`. A private Linux runner used the existing installed dependencies/archive tools with a Git source archive and the final three helper files overlaid; `pg_dump` reports16.15. Tested working-file SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `restore-correction-projection.ts` | `07b70d7f11f0ce8c857a842be9baa555bb72b4877c85b8f34dad3e4d155ea582` |
| `verify-backup-correction-drill.ts` | `90a7870c656a3ceb6a507f4068bd7d8d39557b1494e8fbd7f6e4f21ad0c72913` |
| `verify-backup-restore-container.ts` | `bcba8169b4cf96cc6ef3bb242e5dc1383695d62a6c331840554f9350a76a442d` |

The reused Prisma client contains additional whole-deck models; the exercised application schema matches main, apart from deliberately added future-column fixtures. CI installs from the lockfile, generates this branch's client, migrates the source and reruns the same actual control on separate PostgreSQL services. The fixture never starts a web app, real capture device or outbound worker. It does not establish online backup, power-loss durability, physical operation, installed-image deployment or user acceptance. An installed source capture uses its installed image; it needs the updated helper image before claiming deployed-drill repair. Current review images remain unchanged.

The first fixture attempt used an invalid synthetic `VERIFIED` label state and failed its real SQL constraint before capture; the fixture now uses the supported `UNVERIFIED` state. The original failure is retained. An initial full-row JavaScript projection passed, then was replaced to keep large private payloads inside PostgreSQL; only the final SQL-projection runs qualify this implementation. A fixture-array typing failure was corrected before final typecheck and the final actual run. No product protection was weakened.

## Reproduction and cleanup

Use the dedicated Verify job or a new disposable Linux runner with matching PostgreSQL tools, `/app/node_modules`, private writable `/app/data/backups`, `/input` and `/drill`, and two brand-new databases. Set `MTG_LOCAL_PILOT_TEST=1`, `MTG_CORRECTION_DRILL_FIXTURE=1`, `DATABASE_URL` pointing to `postgres/mtg_drill_source922`, and `CORRECTION_DRILL_RESTORE_URL` pointing to `drill@restore-db:5432/mtg_restore_drill`. Migrate only the source, then run `npx tsx scripts/verify-backup-correction-drill.ts`. Endpoint, empty-target and source-emptiness guards reject existing saved installations. The parent owns the disposable lifetime; never redirect these fixed paths/endpoints into a review app.

Desktop cleanup verified exact ownership, no active test/database clients and no external volume/network references, preserved the small actual archive/evidence/failure records, then removed only the three fixture containers, two anonymous fixture volumes and private internal network. The runtime claim is released. All84original-review fingerprints match; current review apps/images/volumes remain. The configured Foundry hub was unavailable, so repository/GitHub evidence supplied planning context. #305/#310/#302 remain open for broader criteria. Independent/Brian review, individual merge approval, deployment and user acceptance remain separate.

## Timezone review correction

Independent review found that PostgreSQL JSON serializes the UTC `TIMESTAMP(3)` fields without an offset. The original parser treated them as the Node runner's local time: the same one-second guard passed in UTC and failed in America/Chicago. That original negative is retained. The shared capture/restore timestamp check now explicitly interprets the known offset-free UTC representation as UTC; explicit offsets stay explicit. Accepted syntax is bounded and the actual operation window and single-transaction equality are unchanged.

Focused controls launch separate UTC, America/Chicago and Asia/Kolkata processes, assert their actual clock offsets, accept the real PostgreSQL fractional/whole-second representation and explicit-offset forms, and reject times one millisecond outside the window. The actual PostgreSQL drill additionally reads typed TIMESTAMP values through `jsonb_build_object` and checks that representation directly. Hosted drill CI now requests America/Chicago and asserts its real offset before the complete capture/restore lifecycle.

The local non-UTC run at product8b7b2f57 passes in6,544ms with the actual300-minute offset: capture273ms, forced restore866ms, archive53,521bytes. Both real-dump mutation refusals, all16restored-SQL negatives, all84source/target conservation controls, original bytes and existing credential/scanner/worker/canary/checkpoint gates pass. The source application remains main3b06f208; no application/schema/retention/quiescence change. Tested Linux payload SHA-256: projection`af59b931c9e88fb5608b9b6490c8755bfb97a21e8392fb94da9fbb1d6399ff22`, fixture`acf2b3c4145c237dd28e3c99659e1fc4fb02215e87f532397f92cc2678ef2d0f`; the container helper hash above is unchanged. Earlier UTC results and their source hashes remain historical evidence, not this correction's final-head checks. Current CI, cleanup and re-review state are recorded on the PR. The80-table/volatile/count-only, native/physical, deployment and user-acceptance limits remain unchanged.
