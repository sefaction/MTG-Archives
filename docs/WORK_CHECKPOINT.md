# Resumable work checkpoint

Updated 2026-09-19. Reconcile with git, GitHub, Docker, and command logs on resumption. GitHub is authoritative.

## Authority

Work through the open queue, test locally, open one PR per coherent batch, and continue independent work while questions/reviews await the user. Local code, Docker and snapshot data may change. No production or unrelated-machine operations. Every PR needs individual merge approval; close resolved issues only after merge. No recurring scheduler is configured.

## Current stack

### Current checkpoint (supersedes historical entries below)

- 2026-09-20: #233 `feat/playtest-advanced` app/tip `523b4de` is READY after full verification: 531 units, typecheck, host/Linux builds and manifest guards, 28 browser passes / two existing detail/meld fixture skips. Docker image `sha256:1089548e97923f15b3daa038400fed42ce205e3dbd4d4e14ebab6b09cb979381`, build `gJls8QXvxkIpDKWfIb42p`. Full log `test-results/playtest-verify.log`. No merges; #162/#167/#222 remain pending review/merge.
- SMTP #151 prepared independently in `C:\Users\brian\Projects\MTG-Archives-smtp-worktree`, branch `feat/smtp-email`, based on #233. Basic implementation and six new tests (including loopback SMTP) pass, 537 total units. Typecheck fix for injectable env typing is being verified. No SMTP Docker build/migration/browser/real-queue test yet. Next: transfer branch to primary checkout, add real local queue/capture and browser verification, production/compose docs, then PR. Use ONLY local mail capture, never actual mail to snapshot users. New optional docker-compose.smtp-test.yml pins Mailpit v1.31.2 with UI bound to loopback 18025 and no relay. SMTP defaults disabled in production config.

- Paste PR is #232, tip `88b4fe5`, ready, based on #229. Current branch `feat/playtest-advanced`, app `1771b13`, based on #232. #167/#222 implemented; 531 units pass. First Docker build found React effect lint errors; corrected, targeted ESLint passes. Rebuild `test-results/playtest-docker-final.log` (command 84664) has completed compilation, lint/typecheck and all six manifest guards and is exporting image. Wait for completion/health before browser tests. New `tests/ui/playtest-advanced.spec.ts` covers unique 80-card fixture, full-library search, advanced controls, files, stale deck, phone/private/no-write cases. `docs/PLAYTEST_ADVANCED.md` records contract. Next: targeted browser tests, screenshot inspection, full verify, PR. No browser test or PR yet for playtest.

- #221 -> #226 -> #227 -> #228 -> #229 are ready, stacked in that order. None has merge approval. #228 app `22055ad`, remote docs tip `c493661` (local branch ref may lag); #229 `cbc1b94`.
- Current `feat/pasted-decklist-review`, app `a039bbd`, is ready to push/open against #229. Resolves revised paste-only #190, exact cached/owned face-name bug #230, and literal card name Foil bug #231. No direct Moxfield integration.
- Completed full verification: 526 units, typecheck, production build/manifest guard, 27 browser passes / two existing detail/meld fixture skips. Log `test-results/paste-verify.log`.
- Exact supplied 100-card list separately passed owned-only browser resolution, 99 mainboard + Esika commander import, unchanged inventory and private access denial. Unique temporary fixture removed. Log `test-results/paste-supplied-browser.log`; supplied list remains local/ignored.
- Desktop and 390px phone screenshots inspected. Current healthy Docker image `sha256:5e8215eb6a347f38fe33ebfb9955ac564f3e7ebb24f0d14590d7e30f113017cd`, build `dVm-ivE2bp90oH-GhngEh`, cumulative app `a039bbd`.
- NEXT: finish paste PR, then #222/#167 advanced playtest and #151 SMTP. Never send actual mail to snapshot users; local capture only. Never overlap browser tests with builds. Historical pending checks below have completed.

- Released main `9a3fd8b`: prior approved #210/#217/#219 merged. Those approvals do not cover this stack.
- #221 `fix/inventory-filter-navigation`: addresses #220 with document GET advanced filters, scroll/panel restoration and history coverage. 510 units, 25 browser passes / 2 existing skips, mixed stress 20/20. See INVENTORY_FILTER_NAVIGATION.md.
- Draft #226 `perf/location-browser-scale`: app commit `97a0095`, tip `d664f49`, based on #221. Addresses #215: 25-card/tree pages, search, one editor. 515 units; scale/owner/phone/vault checks pass. Last full rerun: 24 passes / 2 Scryfall latency failures (#224) / 2 existing skips. Keep draft pending full regression recovery.
- Ready #227 `fix/dependency-security`: `87dab99`, based on #226. Addresses #225. Full/production audits zero known vulnerabilities. Generation/typecheck/515 units/host and Linux builds pass. Sharp PNG/WebP/AVIF round trips pass; 57 migrations current. Browser run EXCLUDING two known #224 cases: 24 passes / 2 existing skips. Not a full-suite-green claim. See DEPENDENCY_SECURITY.md.
- Current `perf/inventory-query-metadata`, app commit `dc9df7e`, based on #227. Addresses #224: access-scoped scalar candidate IDs then 500-card batches of evaluator metadata and required raw fallbacks. No result cache/evaluator rewrite. Typecheck and 518 unit tests pass. Docker build in progress: test-results/query-docker.log. DB parity/browser validation pending.
- Last healthy security image `sha256:e070ed97da07140a27b969f792983fdfe950b3d0b97fe82be6fd206fc39bd3ee`, build `Ua715ZjFkUjM5kd6DklM3`. URL http://127.0.0.1:13001. Query build will replace it; verify identity and host health before tests.

## Immediate next steps

### Latest progress (supersedes pending checks below)

- #228 application revision `22055ad` (docs tip `c493661`) passed all 59 DB parity expressions. Type projection 1.8 MB / 764 ms vs full metadata 81.5 MB / 6,115 ms. Cumulative full verify: 523 units, host build, 26 browser passes / 2 existing skips; both unchanged Scryfall tests pass. #226 and #228 are now ready for review.
- Ready #229 `fix/production-client-manifests`, `cbc1b94`, adds six-route build reference/chunk validation. Host and Linux builds/guards pass; runtime route smoke 7/7. Last healthy guard image `sha256:b676dbc71b881758df088cfb10b48d4332e61473579bff5bdd18cb62b38304f8`, build `kIyMvuBmYsCG2UZfizTo-`. No merges.
- Current branch `feat/pasted-decklist-review` based on #229. Uncommitted #190 work: paste/section/printing guidance, commander quick assignment, URL rejection, stale-review and busy-state protection, phone layout, successful import redirects to deck; #230 exact DFC face matching in cache/owned resolution; #231 preserve card name Foil and explicit trailing finish annotations. Added parser/name tests and opt-in `tests/ui/pasted-decklist.spec.ts`.
- All 100 names in the user's local ignored export have cached printing matches. Browser test defaults to a compact 99 Forest + 1 Esika fixture, or uses `MTG_PASTED_DECK_FIXTURE=test-results/moxfield-user-export.txt` for the exact supplied list. Creates a unique private fixture owner/deck/inventory and removes it in finally; no real deck commit. Test checks resolution, assignment, stale/busy guards, phone width, 99+1 committed list, unchanged inventory and unauthenticated denial.
- Paste Docker build in progress: `test-results/paste-docker.log` (command session 28873). Typecheck passed; prior 523 units passed before adding three new unit cases, which passed targeted. Next: confirm build/host health, run full supplied-list browser case, inspect screenshots, then full verify and PR. Do not build while browsers run.

1. Finish query Docker build; inspect Imports manifest, health and host HTTP 200. Never overlap Docker builds and browser tests.
2. Run read-only local parity: `docker exec -e MTG_LOCAL_PILOT_TEST=1 mtg-archives-web-1 npx tsx scripts/verify-inventory-query-metadata.ts`. Compares full/projected metadata and representative expressions in one repeatable-read transaction; reports size/time. No writes.
3. Full host verify and serial browser suite including unchanged Scryfall tests. Inspect failures; do not inflate timeouts. Open query PR/update review evidence.
4. #223: post-build client-manifest validation. Prior Linux build omitted Imports SingleCardInventoryAdd, digest 1764835380. Clean unchanged-code rebuild recovered; Next 15.5.25 also includes it. Recovery does not prove a permanent compiler fix.

## Product queue

- #190 user revised scope to pasted lists, NOT direct Moxfield connectivity; GitHub/Foundry updated. Do not pursue scraping/relays/API access. Local ignored fixture test-results/moxfield-user-export.txt; confirmed Esika commander. Explicit Commander heading yields 99 mainboard + 1 commander with no warnings. Printing resolution/commit not tested yet. Improve paste/section/printing guidance and test complete import without unintended inventory changes.
- #222 library search incorrectly applies first-50 cap before matching; fix with playtest.
- #167 / #162 playtest phase 5: positioning/grouping, tokens/copies, named counters and P/T, library/random tools, opponents/damage, multiselection, bounded device-local saves and versioned files, keyboard/touch. Phases 1–4 merged. Do not close before all accepted scope delivered.
- #151 SMTP: env config, templates, category preferences, user email, test action, async queue/retries/history. Local test delivery only; never send mail to snapshot users' real addresses or expose SMTP credentials.

## Diagnostics / resumption

- #224 baseline: 7,308 distinct printings, ~81 MB JSON; inventory distinct+card ~7.1s, Card semijoin still ~6.3s. Payload remains costly.
- Two detail/meld browser fixture skips are not passes. Scale fixture is 150,000 copies / 3,000 stacks of one printing, not 150,000 unique printings.
- Keep authenticated traces/user data/supplied deck fixture local and ignored.
- Preserve unrelated changes. Read AGENTS.md and Foundry hub/workflow/relevant notes before batches; durable decisions in Foundry, temporary details here/PRs. Check command completion rather than assuming success after interruption.
