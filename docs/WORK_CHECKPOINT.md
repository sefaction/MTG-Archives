# Resumable work checkpoint

Updated 2026-09-20. Reconcile git, GitHub, Docker and processes before resuming; GitHub is authoritative.

## Authority

Continue the approved audit/feature queue, one PR per coherent batch, cumulative local Docker. **Each PR needs individual user merge approval; no pending PR has it.** Local MTG code, containers and snapshot data are authorized, not production or unrelated projects. Questions block only the affected decision. No recurring scheduler is configured; checkpoints do not automatically restart work.

## Released baseline and review stack

Released main: `e98266fa39cc33023e0b877417c0ced82c5430df`. Prior approved PRs through #236 merged and the published image revision was verified. No Unraid deployment.

Pending stack, in dependency order:

1. #243 `perf/inventory-render-pipeline`, tip `0981089`: reusable collators reduce sort CPU; browser median about 33% lower. Fixes #224; #220 remains observation.
2. #244 `fix/preserve-bootstrap-admin`, tip `fe48d15`: create-only provisioning fixes #242. Concurrent setup and existing-account preservation verified.
3. #247 `test/isolated-backup-restore`, tip `cfba334`: fixes #245/#246, covers #237. Rebuilt-image isolated recovery passed: 48 full table digests plus legacy-price count, 12,477 copies, four roots / 21 entries, malformed-dump guards and real SQL rollback. Disposable targets cleaned.
4. #248 `ci/verification-release-gates`, tip `f4631cd`: portable verification and ordered publishing, covers #241. User-approved main ruleset 23732060 requires Core verification, strict up-to-date, no bypass. Preceding branches gained/passed the check without rewritten history.
5. #250 `test/trade-lifecycle`, tip `782b87f` (app `7233d7c`): fixes #249 provenance loss/#252 duplicate completed history, covers #238. Two-user lifecycle and copy conservation passed.
6. #254 `fix/validated-auth-sessions`, tip `08d287f` (app `cd5c469`): fixes #251. Opaque hashed credentials, expiry/revocation, password binding, rotation, admin reset/edit invalidation and rejection of identity-only legacy cookies. Additive 59th migration; fresh login required. Full 558 units/37 browser cases passed.
7. #255 `fix/local-login-redirects`, tip `9c2f10b` (app `45bf2de`, tests `e53fa28`): fixes #253/#256. Local return-path validation and requested-page preservation across retries; email test/cleanup corrected. Full 561 units/39 browser cases passed.
8. #259 `test/commander-league-lifecycle`, app/test `76f0d8b`: covers #239, fixes #257 malformed-count empty games and #258 stale error after success. Full verification passed below; ready for individual review.

All issues remain open until their resolving PR merges. Passing CI never replaces individual merge approval.

## Current milestone: League audit complete

Branch `test/commander-league-lifecycle`. The normal lifecycle initially passed against #255. Expanded baselines reproduced a stale validation banner and one empty game created from a nonnumeric count. Both were confined to a disposable league and cleaned. Integer guards and clean success redirect now pass malformed/fractional counts, duplicate rejection and corrected feedback.

Final verification at `76f0d8b`: **563 units**, generation/typecheck, Windows/Linux production builds/six manifest guards, corrected League case (19.8s), and **all 40 serial browser cases with zero skips** (4.3m). Linux core run `35527697072` passed. All command processes completed. Fixture users/leagues verified zero; original inventory remains **12,477 physical copies**.

Current Docker: `sha256:14cd31c69a66501c5a5378257047c29e297cb606c82a7572e8375f79ce4f34de`, healthy/host HTTP 200, application `76f0d8b`. Includes all eight pending PRs above. Logs: `league-docker.log`, `league-corrected-browser.log`, `league-full-verify.log`. Historical local baselines: `league-lifecycle-baseline.log` (test label correction), `league-lifecycle-browser.log` (normal pass), `league-feedback-baseline.log`, `league-count-baseline.log`. See LEAGUE_LIFECYCLE.md for coverage limits.

## Next active task: visual vault #240

Two **untracked, unintegrated drafts** exist for the next batch: `components/VaultSectionMap.tsx`, `lib/vault-navigation.ts`. Do NOT include them in #259. After committing only League evidence/docs, switch to a new feature branch based on #259 and carry these files forward. They are not in Docker and not yet typechecked/tested.

Foundry Inventory Organization was read. Requirements: six sections in one physical row, Sect 0–5 left to right, advisory capacity 85, preserve arbitrary labels and unsectioned cards, desktop first/practical phones. Draft component renders counts/room/overflow, horizontally scrollable six-section tray, extras/unsectioned links and optional Move here callbacks.

Planned integration:
- Locations vault cards plus the single-vault Inventory view.
- Preset the existing move dialog (destination ID/section, quantity mode all, clear error, open) without changing safe mutation logic.
- Implement shared `locationSectionMatch=exact|empty` in inventory filters/API and advanced-search UI/chips. Current section search is case-insensitive contains and MUST retain compatibility. Exact map browsing must not mix Sect 1 with Sect 10; empty means null/empty section.
- `getStorageLocations` in lib/storage-summary.ts already includes a section named empty string for unsectioned copies. No new aggregate query/type field is needed. Locations currently excludes unnamed groups and computes unsectioned as direct total minus named sums; pass that count override to the component.
- `InventoryBrowser` has currentLocationId/storageLocations, selectedCardsCount, setBulkDestinationLocationId/setBulkSection/setQuantityMode/setMoveLimit/setMoveError/setMoveOpen and pageHrefBase. Render map only for an authorized single selected Vault. No public mutation controls.
- Preserve six-column physical layout, keyboard links/focus, viewport-contained horizontal scrolling, owner boundaries, extras and cancellation/error behavior. Add owned-fixture browser moves/refresh/exact section/empty section/scope/desktop+phone tests and inspect screenshots.
- Draft navigation helper uses filter mode that is NOT implemented yet; do not claim feature complete.

## Remaining queue

- Finish #240 and then proportionate parity/UX audits.
- #220 residual inventory navigation observation remains open even when regression tests pass.
- Larger product additions need clarification; connections between installations and broader storage visualization remain roadmap directions.
- No outstanding user question blocks the approved queue. The user chose to keep the current model and continue.

## Local operating reminders

- App http://127.0.0.1:13001; capture-only Mailpit http://127.0.0.1:18025.
- Preserve `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.smtp-test.yml`. No real snapshot email. One LOCAL global trade announcement webhook remains disabled; tests refuse enabled endpoints.
- After explicit build, use `up -d --no-deps --no-build --pull never web` to avoid the local build policy causing a second build.
- Browser tests serial with `MTG_LOCAL_PILOT_TEST=1`, isolated headless Chromium, not another project's profile. Never overlap browser tests with heavy builds. Confirm host HTTP as well as container health.
- Private logs/traces/fixtures stay ignored under `test-results`; backups under `.local-data/backups`. Never publish credentials, user deck contents, authenticated traces or archives.
- Compatible private recovery capture: `.local-data/backups/drill-e7b779ba-5758-4b40-aa32-b762d9d46bd3`. Older PG18 capture `drill-e171be3b-98c3-403e-87ce-2f3aa99ca6af` is failed evidence, not a verified backup.
- Recovery archive excludes separate pricing DB/configuration/master key. Filesystem copy is not atomic with DB replacement. Revoke restored AuthSession records before exposing a restored web server; see AUTH_SESSIONS.md.
- Read Foundry hub/workflow/relevant notes before batches. Durable knowledge goes there; code/test evidence in repo/GitHub.
