# Backup failure propagation qualification — October 15, 2026

Related issue [#814](https://github.com/sefaction/MTG-Archives/issues/814), PR [#815](https://github.com/sefaction/MTG-Archives/pull/815). Source repair: `726587ecf8467ab3bf0c15277d27af81dc2ca35d`; cumulative source integration: `a7a5736843e9852fcd65ac28c99b1faf2ab34a0a`.

## Reproduced boundary and repair

`createBackup()` used nested finally blocks for correction backup-guard release and temporary workspace removal. When an operation failed and cleanup failed too, the last cleanup error replaced earlier errors. A completed archive operation followed by two cleanup errors also lost the first cleanup error.

The actual unchanged-main function is exercised through fixed in-memory adapters: dump, guard release and workspace removal throw distinct sentinel errors; both cleanup calls run and only the workspace error survives. The new preservation regression fails on that source. The first harness omitted its `buildPgEnv` adapter and reached a ReferenceError instead of the intended dump step; that failed record is retained and is not the specific dump-failure proof. Corrected baseline controls explicitly establish the intended three errors and call order before qualifying the repair.

The repair keeps the existing operation and cleanup sequence. Every outward operation/guard-release/workspace error is retained in occurrence order. A lone thrown value is rethrown unchanged; multiple failures produce an AggregateError with the first as cause. Its message begins with the first Error's message so existing CLI summaries retain that diagnosis, with a retained-failure count. Falsy throws remain failures. Successful return values, commands, archive composition and retention are unchanged.

No guard release/expiry policy, internal Prisma/disconnect implementation, retry, source pin, deletion, restore, scanner, model, Inventory or production behavior is changed. The established 64 decimal GB per-owner allowance and 2% prospective controls remain intact.

## Checks and limits

- Fifteen actual-function controls pass on Windows and in the rebuilt Linux web image, without a database, files or external commands from the function's fixed adapters. They cover operation stages, guard admission/release, workspace failure, ordered multiple errors, successful cleanup/results and five falsy throws.
- Thirty-five existing backup/drill controls and type checking pass. All three required checks pass source head `726587e` in [run 38714484195](https://github.com/sefaction/MTG-Archives/actions/runs/38714484195). Report-only final-head CI is verified separately in the PR/checkpoint.
- These fault controls do not execute a real pg_dump, archive, backup-guard database update or restore, and do not establish a historical backup incident or complete recovery acceptance. Existing broader recovery scopes remain separate.
- The first local image build failed because offline apk could not fetch a PostgreSQL client prerequisite. All 23 service/configuration/lifetime and native event baselines remained exact. Its log is retained. One corrected build allowed the required public dependency download and completed; no application or runtime failure is inferred from the offline prerequisite failure.

## Loaded cumulative local runtime

Only the seven-role review project's web service is recreated, after current manual/reviewer inactivity, idle queues, exact source and full paired service/data baselines. Local review is available at `http://127.0.0.1:13011`.

- Web image index: `sha256:9bc7176827b090abca1d8379e9a2b3fa3c3f9e562efd1b81361e7dda2e25940f`.
- Linux/amd64 manifest: `sha256:77d3e36edff1a1f901290c7f0af17e94f2798723f37755634ce0c7a4ac4475fa`.
- All 626 cumulative manifest inputs match digest `80886db0f7b5587eb749a2fdb640e25e3902a04e9f20e1a02bc86a70e224942a`; all 332 actual lib/scripts files in the image match. Compared with the previous complete cumulative source, only `lib/backup.ts` changes.
- Actual `lib/backup.ts` byte SHA-256: `6654b142fea12a75fbc84cd4f75264af4f26e80fabcd47a8586d4e9b15ad7371`.
- The image's runtime Config equals the previous web image Config. The compiled admin action's traced server dependency includes the repaired error path. The first assertion looked only in the route wrapper and failed; the unchanged image's route trace identifies the actual chunk (`920.js`, SHA-256 `25d9103698b82038507b824a8a16f0c4aa059fa7427b34309a08c414118d0183`). The failed wrapper guard is retained. No rebuild or reload was used to resolve that assertion.

Post-load verification preserves every keyed web environment value, mount and resource setting. Planned differences are image/Compose metadata, default hostname and environment array order. A bounded permutation of its five Bind entries restores the exact original whole HostConfig hash; an unrelated resource mutation is rejected. Web is running with zero restarts/OOM and `/login` returns 200.

All 16 primary services and six unrelated review services retain exact images, full configuration, storage, identities and lifetimes. Native cgroup event counters are unchanged. Native inference images, Python/model identities and source remain at their prior qualified versions; they are not restarted for an unused backup CLI/admin module. Their prior application source differs from the rebuilt web by this intentional `lib/backup.ts` change, and is not claimed byte-identical to the new whole web manifest. Existing native diagnostic and scanner batches remain included cumulatively.

All 157 retained originals (904,889,236 bytes), catalogue projection (118,505 total / 109,292 paper), entire review-upload manifest, 11 actual review table fingerprints and one absent-table marker match before/after. Review jobs, capture, sessions, Inventory and correction examples remain empty. The canonical Compose pointer changes only the web image. No shared database reset, real backup/restore, physical operation, production deployment, PR merge or issue closure is performed.

Private controls, failed prerequisite/guard logs, source/image proofs and paired conservation snapshots remain under this batch's ignored `.local-data/backup-cleanup-qualification` directory and the issue-worker's private run directory. Separate reviewer handles readiness, individual approval, merge and closure; passing fault controls are not approval or universal backup acceptance. Do not repeat successful costly build/load/conservation checks without a new source change, failure or specific acceptance question.
