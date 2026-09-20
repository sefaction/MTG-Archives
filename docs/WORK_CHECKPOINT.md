# Resumable work checkpoint

Updated 2026-09-20. Reconcile git, GitHub, Docker and running processes before resuming. GitHub is authoritative.

## Authority

Implement the approved audit/feature queue, open one PR per coherent batch, and load cumulative local Docker review builds. Each new PR requires individual merge approval; none has it. Close resolving issues after merge. Local MTG code, containers and snapshot data are in scope; production and unrelated projects are not. No recurring scheduler is configured.

## Released baseline and active batch

- Main `e98266fa39cc33023e0b877417c0ced82c5430df` contains the nine approved and merged PRs #221, #226, #227, #228, #229, #232, #233, #234 and #236. The published main image revision was verified. Post-merge verification passed 537 units and all 33 serial browser cases, zero skips, Windows/Linux production builds and six manifest guards. No production/Unraid update was performed.
- Ready PR #243, `perf/inventory-render-pipeline`, application commit `59f7a23`, documentation tip `4774b5d`, addresses residual #220/#224. Shared comparators reuse Intl.Collator with original locale/options rather than constructing localeCompare options per comparison. No data/query/scope changes.
- Synthetic 10k-group two-sort benchmark: before 2214/1790/2092 ms; after 140/117/131 ms. See `docs/INVENTORY_SORT_PERFORMANCE.md` for evidence and limits.
- Docker rebuild passed; current container healthy, host HTTP 200, image `sha256:71d953cac99879eceef13fbdb88d28a875ab1adefb3ae346feaffd9248cc140f`. Build log `test-results/sort-docker.log`.
- Eight repeated private/public expression and color regression cases passed. Four fresh-context after timings: 2790/3205/2254/2244 ms versus 4644/3379/3782/3783 before (median about 33% lower). Full verify passed: 540 units, generation/typecheck/build/six manifest guards, all 33 browser cases with zero skips (2.9m). Logs: `sort-search-regression.log`, `inventory-pipeline-after.log`, `sort-verify.log`. PR #243 and issues updated. #220 remains open for observation.
- Initial diagnostic attempt stopped before measurement at the password-change screen. Investigation found every Docker start resets existing admin credentials/profile; new bug #242. Fix in a separate batch before recovery drill.
- Ready PR #244, `fix/preserve-bootstrap-admin`, based on #243, application `2f3869c`, docs tip `fb9dc4b`. All 543 units and typecheck passed; two targeted admin/settings browser checks passed. Docker build/manifest gates passed, image `sha256:222d24a132929175f3fae9297cde6e020143f0877574149f124be6de4698ae9c`, healthy and host HTTP 200. Existing admin/owner fingerprint matched exactly after restart; no account state published. Real PostgreSQL fixture passed concurrent fresh bootstrap and preservation of changed credentials/role/active/profile; synthetic records removed. Logs `bootstrap-docker.log`, `bootstrap-integration.log`, `bootstrap-units.log`, `bootstrap-browser.log`.
- Active branch `test/isolated-backup-restore`, based on #244, initial tooling `0680b31`. #237 real capture revealed #246 (PG18 client versus PG16 server) and #245 (destructive restore before payload/target validation). Initial old-image restore FAILED, no recovery success claimed. All temporary drill containers/networks cleaned; original snapshot untouched. Private old-client archive/evidence retained at `.local-data/backups/drill-e171be3b-98c3-403e-87ce-2f3aa99ca6af` (never publish).
- Draft PR #247 contains recovery fixes, tip `0acccf6`, stacked on #244. All 548 units passed. PG16 fresh capture and development-library drill PASSED: 49 table comparisons (48 full-content, legacy price cache count-only), 12,477 physical copies, four appdata roots / 21 file+directory entries; source capture 65.5s, restore 93.0s. Dry-run sentinels, missing/corrupt dump preservation and real failing CHECK-constraint SQL rollback passed. All disposable resources cleaned. Fresh compatible private archive/evidence at `.local-data/backups/drill-e7b779ba-5758-4b40-aa32-b762d9d46bd3`; log `recovery-safe-drill.log`. This was a development-only library copy in the target, not final image evidence.
- Final recovery image built from `525d223` (app `0acccf6`): `sha256:cac9e88d502bcbc46776769a6a7ebfd47ad83a8d66be989e2f500be0c717a1e6`, healthy and host HTTP 200. Restore library hash exactly matches checkout. Final no-library-override drill is running to `recovery-image-drill.log` using compatible capture `e7b779ba-5758-4b40-aa32-b762d9d46bd3`. Mark #247 ready only after that and browser checks pass.
- Active branch `ci/verification-release-gates`, app/tooling `d8b3d8f`, PR #248 stacked on #247. Portable verification runner, read-only PR CI and serialized/head-checked publication. Ten focused tests passed. Live GitHub Verify run `35520445332` PASSED (Linux clean install/core gate). No image published from feature branch; publisher execution awaits an approved main/platform release. Local full verification and cumulative Docker rebuild with CI tooling still pending; live web currently contains #243/#244/#247. No new merge approval.

## Approved queue

Latest verification (supersedes in-progress entries above): cumulative #243/#244/#247/#248 Docker build from `01e7ee3` passed, image `sha256:0945717dd1ca31cbd81b629b284a476286e7af7e5930c4e8cc9f1c85fecfb4e5`, Next build `QE7rEpiwJg1USCIdO3Oul`, healthy and host HTTP 200 after startup. Full portable verify passed generation/typecheck, all 550 units, host build/six manifest guards and all 33 browser tests with zero skips (3.2m). Logs `ci-cumulative-docker.log`, `ci-full-verify.log`. Final recovery-image drill also passed (see below); #247 can be marked ready.

Required-check backfill added to #243 (`0981089`) and propagated without rewriting history to #244 (`fe48d15`), #247 (`cfba334`) and #248 (`1d06bb3`, tree identical to `01e7ee3`). All four Linux core runs passed: 35523453767, 35523454037, 35523453517 and 35523453804 respectively. Recheck required checks after base updates; no merges approved/performed. #249 catalogues trade provenance loss discovered while preparing #238. A draft lifecycle test is temporarily ignored at `test-results/trade-lifecycle.draft.ts`; next step is move it onto a focused trade branch and reproduce/fix #249 using isolated synthetic accounts.

1. #220/#224: finish performance validation and open this batch PR.
   - Then #242: make startup admin bootstrap preserve existing accounts; verify fresh setup and restart behavior.
2. #237: isolated backup/restore drill, integrity checks and recovery runbook. Never target the running snapshot database or start outbound workers on restored data.
3. #238: complete two-user trade lifecycle and copy conservation.
4. #239: Commander League season/match lifecycle and immutable deck locking.
5. #240: visual vault workspace. User confirmed six sections in a single row; present Sect 0 through Sect 5 left to right. Advisory capacity 85, extras/unsectioned preserved. Desktop first and practical phone interaction.
6. #241: CI verification and ordered image publication. No automatic merging or production changes.

## Local environment and operating reminders

- App http://127.0.0.1:13001; capture-only Mailpit http://127.0.0.1:18025.
- Preserve all three Compose files: `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.smtp-test.yml`. No real snapshot-user email delivery.
- Run browser tests serially with `MTG_LOCAL_PILOT_TEST=1`. Automated tests use their own headless Chromium sessions, not the user's browser profile. Use dedicated Edge tabs for visible MTG checks; never manipulate another project's tabs. Shared CPU/memory load is still possible. No browser collision was established from the other project's reported failure.
- Never run browser tests during heavy builds. Confirm host HTTP after deployment, not just Docker health.
- Private fixtures, logs and user-supplied deck remain ignored under `test-results/`; do not publish credentials, deck contents or authenticated traces.
- Read Foundry hub/workflow/relevant feature notes before each batch. Durable decisions go in Foundry; code/test details in repository and GitHub.
- User approved required CI on 2026-09-20. Verified active main-only ruleset 23732060 requires GitHub Actions `Core verification`, strict up-to-date checks, no bypass actors (current user cannot bypass). No PR merge approval or auto-merge. Older stacked PRs need verification tooling/checks before merging; never disable the rule to bypass rollout. User confirmed single-row vault geometry and asked to continue.
- Final rebuilt-image recovery drill PASSED without a library override: restore 144.9s, 49 table comparisons (48 full content, price cache count-only), 12,477 physical copies, four appdata roots / 21 entries; dry-run preservation, missing/corrupt dump guards, real SQL-failure rollback and current migrations all passed. Runner reported scoped disposable cleanup complete. Full browser verification and cumulative CI-tooling Docker build remain pending; #247 stays draft for now.
