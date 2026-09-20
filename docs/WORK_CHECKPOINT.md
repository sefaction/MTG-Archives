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
- Active branch `fix/preserve-bootstrap-admin`, based on #243, application `2f3869c`. Create-only case-insensitive bootstrap with transactional owner creation and serialized concurrent provisioning. Three behavior units and typecheck passed. Docker build/manifest gates passed, image `sha256:222d24a132929175f3fae9297cde6e020143f0877574149f124be6de4698ae9c`, healthy and host HTTP 200. Existing admin/owner fingerprint matched exactly after restart; no account state published. Real PostgreSQL fixture passed concurrent fresh bootstrap and preservation of changed credentials/role/active/profile; synthetic records removed. Logs `bootstrap-docker.log`, `bootstrap-integration.log`. Full unit suite and targeted admin/settings browser checks run next; then open PR against #243 branch.

## Approved queue

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
- No unanswered product question currently blocks this queue. User confirmed single-row vault geometry and asked to continue.
