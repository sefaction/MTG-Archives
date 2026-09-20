# Resumable work checkpoint

Updated 2026-09-20. Reconcile git, GitHub, Docker and logs before resuming. GitHub is authoritative.

## Authority

Work through all eligible open issues, test locally, open one PR per coherent batch, continue independent work during review. Each PR requires individual merge approval. No PR in the current stack has approval. Close resolving issues only after merge. All local MTG code, containers and snapshot data are in scope; production and unrelated machine resources are not. No recurring scheduler is configured.

## Cumulative review stack

Released main: `9a3fd8b`. Each branch is based on its predecessor:

1. Ready #221 `fix/inventory-filter-navigation` — #220. App `bf6813f`, tip `60892f0`; document-GET filters/history restoration.
2. Ready #226 `perf/location-browser-scale` — #215. App `97a0095`, tip `d664f49`; bounded cards/tree pages, search and lazy editor. Full cumulative regressions recovered with #228.
3. Ready #227 `fix/dependency-security` — #225. `87dab99`; patched compatible dependencies, full/production audit zero known vulnerabilities.
4. Ready #228 `perf/inventory-query-metadata` — #224. App `22055ad`, remote docs tip `c493661` (local branch ref may lag). 59 DB parity cases; narrow common projections avoid large unrelated raw payloads.
5. Ready #229 `fix/production-client-manifests` — #223. `cbc1b94`; build gate for six critical route reference/chunk contracts. Not a proven framework root-cause fix.
6. Ready #232 `feat/pasted-decklist-review` — revised paste-only #190, exact cached/owned DFC face matching #230, literal card name Foil #231. App `a039bbd`, tip `88b4fe5`. 526 units, 27 browser passes / two existing skips. Supplied 100-card list separately passed owned-only import: 99 mainboard + Esika commander, unchanged inventory. No direct Moxfield integration.
7. Ready #233 `feat/playtest-advanced` — #167/#222, final phase under #162. App/tip `523b4de`. Full verify: 531 units, typecheck, host/Linux builds/manifest guards, 28 browser passes / two existing detail/meld fixture skips. New advanced test covers 80-card fixture, far-library match, positions, annotations, temporary cards, bulk undo, library/random tools, players/damage, validated files, stale saves, phone and privacy. See PLAYTEST_ADVANCED.md.
8. Current `feat/smtp-email` — #151, based on #233. App `30fbf97`, integration/browser test commit `149ca6a`. No PR yet. Typecheck/targeted ESLint and 537 units (including real loopback multipart SMTP) pass. Production npm audit zero known vulnerabilities. Updated test-only cross-user isolation and SMTP docs are uncommitted.

## Current local environment and active command

### Latest SMTP milestone (supersedes pending build/testing below)

- SMTP app `149ca6a` now healthy in Docker: image `sha256:2cbcda763a23ddb15a7ce8516be1e7c15294a27a36bc8dd1f2abfedfae146f0e`, build `ZeZqoQMsFjMejeHmTti-5`, host HTTP 200, all 58 migrations current.
- Real queue integration passed: absent-address local notification, deduplication, actual refused SMTP connection with safe failure history, successful retry into capture, current opt-out preventing send, minimal text/HTML. Log `test-results/email-integration.log`. A requested worker pause command was rejected by tool policy before execution; revised test atomically future-dates fixture jobs and advances only its scoped test clock. Worker stays running. Revised test script was copied into the local container, application code unchanged.
- Email settings browser test passed (including absent-address, cross-account preferences/history isolation, anonymous denial and phone width). Desktop/phone screenshots inspected. Log `test-results/email-browser.log`.
- Next: full verify with capture overlay still active; finish SMTP PR against #233, then bounded coverage audit. Do NOT stop the worker for the revised script. Temporary worktree already removed.

- Last fully verified app: #233 `523b4de`, image `sha256:1089548e97923f15b3daa038400fed42ce205e3dbd4d4e14ebab6b09cb979381`, build `gJls8QXvxkIpDKWfIb42p`. Full log `test-results/playtest-verify.log`.
- SMTP cumulative Docker build is RUNNING: command session 37737, log `test-results/email-docker.log`. Uses common + local + new SMTP capture overlay. Compilation succeeded; wait for completion/health and host HTTP 200 before tests. This build will replace the above image.
- Mailpit image v1.31.2 pulled, digest `sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d`. Optional overlay directs mail only to `smtp-capture:1025`, exposes viewer only at http://127.0.0.1:18025, configures no relay, and clears SMTP credentials. App remains http://127.0.0.1:13001.
- Temporary SMTP worktree was committed, transferred to the primary checkout and removed. Only primary worktree remains. Its unit log was preserved at `test-results/email-unit.log`; newer 537-unit run at `test-results/email-final-unit.log`.

## Immediate next steps

1. Finish SMTP Docker build; inspect host HTTP, migrations (new default-false email preference column/index), image/build identity.
2. Pause ONLY local notification-worker for deterministic queue test. In a PowerShell try/finally: docker stop mtg-archives-notification-worker-1; docker exec -e MTG_LOCAL_PILOT_TEST=1 mtg-archives-web-1 npx tsx scripts/verify-email-delivery.ts; finally docker start mtg-archives-notification-worker-1. Script scopes claims to its unique fixture, verifies failed SMTP connection/history/retry, local capture, opt-out and cleanup. Never run against external SMTP or production.
3. Run targeted `tests/ui/email-settings.spec.ts` with MTG_LOCAL_PILOT_TEST=1, then inspect screenshots and fix findings. Test refuses non-capture SMTP, uses only synthetic accounts/example.test, verifies category persistence, queued test/history, no-address, cross-user isolation and phone width.
4. Full verify including existing queue/webhook/trade tests, npm audit and Compose validation. No builds while browser tests run. Commit final test/docs/checkpoint, push/open SMTP PR against #233. No merge.
5. Audit remaining workflow/feature coverage, including the two old detail/meld browser skips. Do not label skipped cases passed or claim every app feature complete. Catalogue confirmed bugs with deduplication and resolving PRs.

## SMTP behavior and limits

SMTP defaults disabled in normal configuration. Settings → Email notifications uses existing administrator-managed optional user email, per-category opt-in, own-address test action (one durable job per minute bucket), and scoped history. Queue contains IDs only. Delivery rechecks current active recipient, notification ownership and preference, sends minimal text/HTML, sanitizes transport errors, and uses stable Message-ID with at-least-once semantics. Local in-app category must be enabled to generate the stored notification; UI/docs explain this existing dependency. Production SMTP setup is a separate operational step; do not request or record credentials here.

## Operating reminders

Read AGENTS and Foundry hub/workflow/relevant notes before each batch. Durable decisions in Foundry, temporary details in repository/PRs. No secrets, user decks or authenticated traces in public artifacts. Exact supplied list stays ignored at test-results/moxfield-user-export.txt.

Run serial browser tests with MTG_LOCAL_PILOT_TEST=1. Never overlap host/Docker builds or other heavy checks with browser tests. Confirm completion and host HTTP rather than trusting health alone. Scale fixture is 150,000 physical copies / 3,000 stacks of one printing, not 150,000 unique printings. Save checkpoints across interruptions and reconcile running command state.
