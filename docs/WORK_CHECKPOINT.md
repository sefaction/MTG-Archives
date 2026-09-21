# Resumable work checkpoint

Updated 2026-09-21. Reconcile git, GitHub, Docker and processes before resuming; GitHub is authoritative.

## Active design batch: UI consolidation foundation, 2026-09-21

The user approved starting the recommended design batch after the roadmap review. Branch `design/ui-consolidation-foundation`, based on released main `7a32dd3`. Related issues #262/#263/#274; no issue is claimed complete. Scope: capability crosswalk, workspace contract, standalone synthetic Inventory/Locations prototype with sidebar/top navigation, local Docker review and targeted prototype checks. No app source/schema/current app image changes.

- Review: `http://127.0.0.1:13002`, separate Compose project `mtg-archives-design` using `docker-compose.design.yml`. Read-only static mount of `docs/design/ui-consolidation`, installed `node:22-alpine`, loopback port; no application network, database or API access. This preview reflects the current branch files. App remains at `http://127.0.0.1:13001` on the released image below; SMTP capture remains unchanged.
- Completed: source crosswalk for all 34 page routes and grouped action/role invariants; proposed design/token contract; interactive search/filter/chips, selection/details/cancel, simulated capacity-aware move, storage tree/section navigation and six theme previews. Prototype details/limits are in `docs/design/ui-consolidation/README.md`.
- Verification passed: syntax, formatting, 164 targeted checks, real desktop/phone widths, six-theme overflow checks, synthetic 17-copy transfer and quantity conservation, Escape/focus return, exact-section navigation and server allowlist/CSP. Screenshots visually inspected; no captured JS exceptions. Results under ignored `test-results/design-review`. Not a fresh application regression/contrast/scale/permission certification.
- Pending: open the coherent design PR, required CI status, user layout feedback. Recommend sidebar plus filters alongside results and browse-first storage. Review layout before the application implementation pilot (#264-#266). No PR merge approval exists for this batch.
- Reliability #220/#260 remains open; no fixes claimed. #275 is mapped into later Inventory implementation. No production changes or recurring scheduler. Desktop chat project assignment was not independently reverified.
- Next safe step: hand off the running prototype and PR; incorporate design feedback, then implement the reviewed direction in coherent application batches with cumulative Docker and individual merge approvals.

## Resumption baseline: local availability and roadmap review, 2026-09-21

This section supersedes the historical implementation checkpoint below. The user requested getting the project running and reviewing the current roadmap; no UI implementation batch has begun.

- Branch at resumption: `main`, HEAD `7a32dd3f1f1c11565310cc18366866cc26dc4906`, matching live remote main. The worktree was clean at entry; the resumption initially edited only this checkpoint.
- GitHub authentication is valid. All nine PRs listed in the historical stack below are merged. No open PRs were present at resumption. Final main image publication run `35534041423` succeeded.
- Local services were already running. Web is healthy, host HTTP returned 200, both PostgreSQL services accept connections, and the signed-in home page rendered in Chrome. Pricing/notification workers, Redis and capture-only Mailpit are running. No restart or rebuild was needed.
- Running web image is `sha256:973c4b15dc9d4a1c5b20e43e06d8348791e7046093ca087a1f1bc39cf66a26f2`, matching the exact released image recorded in Foundry Operations. Compose uses the base, local and SMTP-test overlays. App: `http://127.0.0.1:13001`; capture inbox: `http://127.0.0.1:18025`.
- Current roadmap: UI consolidation umbrella #262; foundation/capability map #263 and acceptance ledger #274 first, Inventory/Locations pilot #264-#266 plus copy defect #275 next, then remaining workspaces #267-#273. All #262-#275 are open. Foundry UI Consolidation Plan is the design input; old feature-queue instructions below are historical.
- Independent reliability issues #220 (intermittent filter navigation) and #260 (stale post-move vault occupancy) remain open. No new reproduction or fix is claimed.
- Completed this session: reconcile Foundry hub, roadmap, UI plan, operations and workflow with git/GitHub; verify local availability. Full automated tests, mobile layouts and deep workflows were not rerun. Prior 568-unit/41-browser release evidence remains historical.
- Outstanding choice: review the proposed design-first starting point with the user. Recommended next batch is capability mapping and alternative navigation/Inventory/Locations wireframes under #263/#274, followed by layout review before application implementation.
- No production changes, new feature implementation, merges or recurring schedule. Desktop project assignment was not independently reverified in this session.

## Historical checkpoint from 2026-09-20 (superseded status)

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
9. #261 `feat/visual-vault-workspace`, app/test `1d3330e`: covers #240. Full verification passed; remains draft because intermittent stale move occupancy #260 is not understood or claimed fixed.

All issues remain open until their resolving PR merges. Passing CI never replaces individual merge approval.

## Previous milestone: League audit complete

Branch `test/commander-league-lifecycle`. The normal lifecycle initially passed against #255. Expanded baselines reproduced a stale validation banner and one empty game created from a nonnumeric count. Both were confined to a disposable league and cleaned. Integer guards and clean success redirect now pass malformed/fractional counts, duplicate rejection and corrected feedback.

Final verification at `76f0d8b`: **563 units**, generation/typecheck, Windows/Linux production builds/six manifest guards, corrected League case (19.8s), and **all 40 serial browser cases with zero skips** (4.3m). Linux core run `35527697072` passed. All command processes completed. Fixture users/leagues verified zero; original inventory remains **12,477 physical copies**.

Previous Docker: `sha256:14cd31c69a66501c5a5378257047c29e297cb606c82a7572e8375f79ce4f34de`, application `76f0d8b`. Logs: `league-docker.log`, `league-corrected-browser.log`, `league-full-verify.log`. Historical local baselines: `league-lifecycle-baseline.log` (test label correction), `league-lifecycle-browser.log` (normal pass), `league-feedback-baseline.log`, `league-count-baseline.log`. See LEAGUE_LIFECYCLE.md for coverage limits.

## Active task: visual vault #240

Branch `feat/visual-vault-workspace`, based on #259 docs tip `83617d4`, app/test commit `1d3330e`, draft PR #261. The map/navigation are integrated in Locations and single-vault Inventory, with exact/empty section filters, advanced-search controls, shared move dialog, five unit cases and an owned-fixture browser lifecycle. Typecheck and all 568 units passed. Initial Docker and original vault pilot passed. New lifecycle initially failed stale occupancy after a successful all-matching move (#260); a focused rerun and five repeats passed. This is not a fix. Keep UI assertion before database diagnostics and timeouts unchanged.

Final current Docker at `1d3330e`: `sha256:563b5245782bc484d84c97ec2a06ff52126adddec6b83e7dfc35ed024af4c46e`, healthy/host HTTP 200. Full cumulative verification PASSED: generation/typecheck, **568 units**, Windows/Linux production builds and six manifest guards, **41 serial browser cases, zero skips** (3.5m). New map lifecycle passed in 5.9s with the UI count assertion before database checks. Linux CI run `35529120610` passed. Final desktop/phone/Locations screenshots inspected. Fixture users and vault locations returned to zero; snapshot still has **12,477 copies**. All command processes completed. Logs: `vault-final-docker.log`, `vault-full-verify.log`; historical failed/retest logs `vault-browser.log`, `vault-map-recheck.log`, `vault-map-repeat.log`. No pending PR has merge approval.

Foundry Inventory Organization was consulted and updated with durable decisions. Six sections remain one physical row, Sect 0–5 left to right, advisory capacity 85, preserving arbitrary labels/unsectioned cards. See VISUAL_VAULT.md for implementation and coverage. Phone header refinement is included in the current image.

Next safe step: investigate #260 with repeated browser lifecycle runs and credential-free request-completion diagnostics. The first failure was a stale Sect 4 count after a successful 3-copy all-matching move from Sect 10; partial moves refreshed correctly. Inspect server-action revalidation plus the explicit client `router.refresh` without assuming causation. Preserve the original 10-second UI assertion and fixture cleanup. Do not hide it with a reload, longer timeout or database diagnostic before the UI assertion. Keep #261 draft until this observation is adequately resolved or explicitly accepted.

## Remaining queue

- Resolve #260 before completing #240 review readiness, then proportionate parity/UX audits.
- #220 residual inventory navigation observation remains open even when regression tests pass.
- #260 intermittent move occupancy refresh: initial failure, subsequent passes, root cause unproven. Preserve coverage and investigate action/revalidation/refresh behavior; do not mark resolved from passing reruns alone.
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
