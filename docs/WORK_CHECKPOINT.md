# Resumable work checkpoint

Updated 2026-09-19. Reconcile with git, GitHub, Docker, and command logs on resumption. GitHub is authoritative.

## Authority

Work through the open queue, test locally, open one PR per coherent batch, and continue independent work while questions/reviews await the user. Local code, Docker and snapshot data may change. No production or unrelated-machine operations. Every PR needs individual merge approval; close resolved issues only after merge. No recurring scheduler is configured.

## Current stack

- Released main `9a3fd8b`: prior approved #210/#217/#219 merged. Those approvals do not cover this stack.
- #221 `fix/inventory-filter-navigation`: addresses #220 with document GET advanced filters, scroll/panel restoration and history coverage. 510 units, 25 browser passes / 2 existing skips, mixed stress 20/20. See INVENTORY_FILTER_NAVIGATION.md.
- Draft #226 `perf/location-browser-scale`: app commit `97a0095`, tip `d664f49`, based on #221. Addresses #215: 25-card/tree pages, search, one editor. 515 units; scale/owner/phone/vault checks pass. Last full rerun: 24 passes / 2 Scryfall latency failures (#224) / 2 existing skips. Keep draft pending full regression recovery.
- Ready #227 `fix/dependency-security`: `87dab99`, based on #226. Addresses #225. Full/production audits zero known vulnerabilities. Generation/typecheck/515 units/host and Linux builds pass. Sharp PNG/WebP/AVIF round trips pass; 57 migrations current. Browser run EXCLUDING two known #224 cases: 24 passes / 2 existing skips. Not a full-suite-green claim. See DEPENDENCY_SECURITY.md.
- Current `perf/inventory-query-metadata`, app commit `dc9df7e`, based on #227. Addresses #224: access-scoped scalar candidate IDs then 500-card batches of evaluator metadata and required raw fallbacks. No result cache/evaluator rewrite. Typecheck and 518 unit tests pass. Docker build in progress: test-results/query-docker.log. DB parity/browser validation pending.
- Last healthy security image `sha256:e070ed97da07140a27b969f792983fdfe950b3d0b97fe82be6fd206fc39bd3ee`, build `Ua715ZjFkUjM5kd6DklM3`. URL http://127.0.0.1:13001. Query build will replace it; verify identity and host health before tests.

## Immediate next steps

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
