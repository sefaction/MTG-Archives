# Resumable work checkpoint

Updated 2026-09-20. Reconcile git, GitHub, Docker and processes before resuming; GitHub is authoritative.

## Authority

Continue the approved audit/feature queue, one PR per coherent batch, cumulative local Docker. **Each PR needs individual user merge approval; no pending PR has it.** Local MTG code, containers and snapshot data are authorized, not production or unrelated projects. Questions block only the affected decision. No recurring scheduler is configured; checkpoints do not automatically restart work.

## Released baseline and review stack

Released main: `e98266fa39cc33023e0b877417c0ced82c5430df`. The prior nine approved PRs through #236 merged and the published image revision was verified; no Unraid deployment.

Pending, in dependency order:

1. #243 `perf/inventory-render-pipeline`, tip `0981089`: reusable collators reduce inventory sorting CPU; measured browser median about 33% lower. Fixes #224; #220 remains observation.
2. #244 `fix/preserve-bootstrap-admin`, tip `fe48d15`: create-only startup provisioning, fixes #242. Real concurrent-bootstrap and existing-account preservation passed.
3. #247 `test/isolated-backup-restore`, tip `cfba334`: fixes #245/#246, covers #237. Final rebuilt-image isolated restore passed: 48 full table digests plus legacy-price count, 12,477 copies, four data roots / 21 entries, malformed-dump guards and real SQL rollback. Disposable resources cleaned.
4. #248 `ci/verification-release-gates`, tip `f4631cd`: portable verification and ordered image publishing, covers #241. Active user-approved main ruleset 23732060 requires Core verification, strict up-to-date, no bypass. All preceding branches gained and passed this check without rewriting history.
5. #250 `test/trade-lifecycle`, tip `782b87f` (application `7233d7c`): fixes #249 provenance loss and #252 duplicate completed history, covers #238. All 553 units/typecheck, Linux core, Docker and three targeted browser cases passed. Complete two-user lifecycle conserved all 16 fixture copies; fixtures cleaned.
6. **#254 `fix/validated-auth-sessions`, application/test `cd5c469`, based on #250**: fixes #251. Ready for individual review after successful full acceptance below.

The prior full cumulative #243–#248 run passed 550 units, generation/typecheck, Windows/Linux builds, six client-manifest guards and 33 serial browser cases without skips. Later trade batch has focused acceptance; full cumulative security acceptance remains pending.

## Completed login-return follow-up (#253 / #256)

PR #255, branch `fix/local-login-redirects`, application `45bf2de`, test correction `e53fa28`, based on #254 tip `08d287f`. Shared normalized local-return-path guard for login and admin-mode toggles; submitted-field validation, middleware next compatibility and safe wrong-password retry.

Both baseline defects were reproduced locally; the first URL-order harness assertion was corrected before proving lost destination. First full run was **38 passed / 1 failed** because the email test expected the old Dashboard redirect. Its timeout exposed cleanup defect #256. The exact orphan account and captured email were removed; no real account changed. Test teardown now deletes both users before capture cleanup through an independent request context.

Final acceptance **PASSED**: 561 units, generation/typecheck, Windows/Linux production builds and six manifest guards, all **39 serial browser cases with zero skips** (2.8m). Targeted email/redirect retest 3/3 passed (11.0s). Linux core run `35526957981` passed. Auth/login/email/trade fixture users verified zero and physical inventory unchanged at 12,477.

Current local image `sha256:4db6c0bce174b5a6e7530479befda95a3ed4a5ca13f4607b27dca05bbe0a5fd2`, healthy/host HTTP 200. Logs: `login-return-docker.log`, `login-return-browser.log`, `login-return-full-verify.log` (failed historical), `login-return-email-recheck.log`, `login-return-final-verify.log`. All processes completed. Ready for individual review; no merge approval.

**Next safe task: #239 League lifecycle on a new branch based on #255**, followed by #240 visual vault. Foundry roadmap/architecture and current League pages/actions/schema were inspected while verification ran; no League code/test modifications yet. Preserve explicit public-deck versus member-only League boundaries.

## Completed session-security batch

- Implements additive AuthSession migration `20260920170000_auth_sessions`, 256-bit opaque tokens stored SHA-256 hashed, password binding, server expiry/revocation, login/password-change rotation, admin-edit/reset deletion, rejection of legacy identity cookies. Existing users must sign in again; passwords/collection data unchanged.
- Pre-fix synthetic identity-cookie API request received HTTP 200 instead of 401. Regression intentionally failed on the old image; no production testing. Log `test-results/session-baseline.log`.
- All **558 units** and typecheck passed. Added three synthetic browser scenarios (including administrator reset, forced password change and disable/re-enable); browser credentials are excluded from traces/video/screenshots.
- Docker build/deploy completed; production build and six manifest guards passed. Current image `sha256:5785e72f1b7a74107878ae5215f7070a0b7b4f67abd49f31c444666b89b44d90` (application `cd5c469`), healthy/host HTTP 200, all **59 migrations current**. Build log `test-results/session-docker.log`; Compose's build policy caused a second successful build during startup. Use `up --no-build` following an explicit build in future.
- GitHub Linux Core run `35525754981` PASSED. All **three security browser cases passed** (20.9s), including old-cookie rejection and admin reset/disable/re-enable. Log `test-results/session-browser.log`.
- Full cumulative `npm run verify` **PASSED**: generation/typecheck, 558 unit tests, host production build/six manifest guards, all **37 serial browser tests with zero skips** (3.1m). Log `test-results/session-full-verify.log`. All command processes completed. No security PR merge approval.
- Next: focused #253 on a new branch based on #254, followed by League/vault. No security application changes pending.
- New source finding #253: unsanitized login return destination and middleware next/login returnTo mismatch. Focused follow-up after #254; no production/external redirect probing. Reconcile live issue before implementing.
- User chose to retain the current model and continue. No intentional pause.

## Remaining approved queue

- #253 safe login redirect follow-up.
- #239 Commander League season/match lifecycle and immutable deck locking.
- #240 visual vault: six sections in one row, Sect 0–5 left to right, advisory capacity 85, extras/unsectioned retained; desktop first, usable phone controls.
- #220 residual inventory navigation observation.
- Pending PR issues remain open until their fixes merge; do not close them merely because local tests pass.
- After assigned tasks, continue proportionate parity/UX audits; larger product decisions need clarification.

## Local operating reminders

- App http://127.0.0.1:13001; capture-only Mailpit http://127.0.0.1:18025.
- Preserve all three Compose files: `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.smtp-test.yml`. No real snapshot email delivery.
- One LOCAL global trade-announcement webhook was disabled before fixtures and remains disabled; trade tests refuse enabled endpoints. No production setting changed.
- Browser tests run serially with `MTG_LOCAL_PILOT_TEST=1`; use isolated headless Chromium, never another project's browser profile. Do not overlap browser tests with heavy builds. Confirm host HTTP after deployment.
- Private logs/traces/fixtures stay ignored under `test-results`; backups under `.local-data/backups`. Never publish credentials, user deck contents, authenticated traces or archives.
- Compatible private recovery capture: `.local-data/backups/drill-e7b779ba-5758-4b40-aa32-b762d9d46bd3`. Older PG18 capture `drill-e171be3b-98c3-403e-87ce-2f3aa99ca6af` is failure-only evidence, not a verified backup.
- Recovery archive excludes separate pricing database/configuration/master key. Filesystem copy is not atomic with database replacement. Revoke restored AuthSession records before exposing a restored web server; see AUTH_SESSIONS.md.
- Read Foundry hub/workflow/relevant notes before each batch. Durable knowledge belongs there; exact implementation/evidence in repo/GitHub.
