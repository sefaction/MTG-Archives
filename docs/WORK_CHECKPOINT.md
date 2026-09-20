# Resumable work checkpoint

Updated 2026-09-20. Reconcile git, GitHub, Docker and logs before resuming. GitHub is authoritative.

## Authority

Work through eligible open issues, test locally, open one PR per coherent batch and continue independent work during review. Each PR requires individual merge approval. None in this stack has approval. Close resolving issues only after merge. Local MTG code, containers and snapshot data are in scope; production and unrelated resources are not. No recurring scheduler is configured.

## Cumulative review stack

Released main: `9a3fd8b`. Each branch is based on its predecessor:

1. Ready #221 `fix/inventory-filter-navigation` — #220. App `bf6813f`, tip `60892f0`; document-GET filters/history restoration. See later timing observation below.
2. Ready #226 `perf/location-browser-scale` — #215. App `97a0095`, tip `d664f49`; bounded cards/tree pages, search and lazy editor.
3. Ready #227 `fix/dependency-security` — #225. `87dab99`; patched dependencies, full/production audit zero known vulnerabilities.
4. Ready #228 `perf/inventory-query-metadata` — #224. App `22055ad`, remote docs tip `c493661`; 59 real-DB parity cases and narrow metadata projections.
5. Ready #229 `fix/production-client-manifests` — #223. `cbc1b94`; build gate for six route reference/chunk contracts, not a proven framework root-cause fix.
6. Ready #232 `feat/pasted-decklist-review` — paste-only #190, DFC matching #230, literal Foil #231. App `a039bbd`, tip `88b4fe5`. 526 units, 27 browser passes / two historical skips. Supplied 100-card list separately passed: 99 mainboard + Esika commander, unchanged inventory. No direct Moxfield integration.
7. Ready #233 `feat/playtest-advanced` — #167/#222, final phase under #162. `523b4de`. Full verify: 531 units, builds/manifest gates, 28 browser passes / two historical detail skips. See PLAYTEST_ADVANCED.md for validated local save/file limits.
8. Draft #234 `feat/smtp-email` — #151. App `30fbf97`, tests `149ca6a`, tip `77e4a08`. 537 units, typecheck, host/Linux builds pass. Real queue failure/retry/capture/opt-out fixture and settings browser pass. Full cumulative run had one search timing failure, 28 browser passes, two historical detail skips. Isolated private/public search rerun passed. Final full run pending audit.
9. Draft #236 `test/inventory-detail-fixtures` — #235. Current app `dad1bd3`. Native detail modal, focus/Escape/backdrop behavior, deterministic owned Hanweir tests, coverage ledger. Docker build passed; all four targeted detail tests passed. Native browser chrome may receive Tab focus, but inert background app controls cannot. Desktop/phone screenshots inspected.

## Local environment

- App http://127.0.0.1:13001; Mailpit viewer http://127.0.0.1:18025.
- Use `docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.smtp-test.yml` for cumulative review builds. Capture overlay sends only to `smtp-capture:1025`, clears SMTP credentials and has no relay. Normal deployments remain SMTP-disabled. Never contact real snapshot-user recipients.
- Current healthy cumulative image: app `dad1bd3`, image `sha256:7247503387af017aa862c9c9c1750637bee9d57c41b1b0ed7945a7fcf583698e`, build `29QGmn8T55qnVQuSACupv`, HTTP 200, 58 migrations current. Docker log `test-results/detail-docker.log`; detail browser log `test-results/detail-browser.log`.
- SMTP queue test atomically future-dates its own fixture jobs and advances only a scoped test clock. Do NOT stop the notification worker. Integration log `test-results/email-integration.log`; browser `email-browser.log`; full `email-verify.log`; search recheck `search-recheck.log`.
- No temporary worktrees remain. User-supplied deck stays ignored at `test-results/moxfield-user-export.txt`; never publish it or authenticated test traces.

## Audit findings and next steps

1. Full verify is RUNNING in session 88316, log `test-results/audit-verify.log`. Generation/typecheck, 537 units and host build/manifest guards passed; 33 serial browser cases are underway. Do not run builds or competing browser checks. Docker and targeted detail testing are already complete.
2. Old detail tests did NOT prove missing inventory: they searched for role button on a summary and silently skipped. Corrected locator plus isolated owned fixture passes information/meld checks on old app, and reproduces Escape failure. #235 records this. Baseline `test-results/detail-baseline.log`.
3. Search test in full SMTP run timed out after URL changed; snapshot had main/alert only, no corresponding server render exception. Isolated private/public search recheck passed. Observation recorded on #220; do not hide it or raise timeouts to manufacture a pass. Repeat full serial verification and investigate if recurrent.
4. Finish full verify (units, typecheck, host build and serial browser tests), npm audit/Compose validation; no builds during browser tests. Update coverage ledger, checkpoint and PR evidence. Mark #234/#236 ready only with accurate final results. Never merge without individual approval.

## Operating reminders

Read AGENTS and Foundry hub/workflow/relevant notes before each batch. Durable decisions in Foundry; temporary implementation in repository/PRs. No secrets in either. Run browser tests serially with `MTG_LOCAL_PILOT_TEST=1`. Confirm host HTTP after deployment. Scale fixture is 150,000 physical copies / 3,000 stacks of one printing, not 150,000 unique printings. Deeper trade/League/recovery coverage is mapped in FEATURE_COVERAGE.md, not claimed complete.
