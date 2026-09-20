# Resumable work checkpoint

Updated 2026-09-19. GitHub remains authoritative for live issue/PR status.

## Active queue (2026-09-19, supersedes the historical batch below)

- User requested working through every open issue; #190 (Moxfield) and #151 (SMTP) were explicitly reactivated. Their on-hold labels were removed and the Foundry roadmap updated.
- Current branch: `perf/location-browser-scale`, stacked on #221 (`60892f0`), which is based on main `9a3fd8bbe8798fa0cc8e15592821180108b54e33`.
- First investigate intermittent inventory navigation #220; next large location trees #215, playtest phase 5 #167 / umbrella #162, Moxfield #190, SMTP #151.
- #162 checklist reconciled with merged phases 2–4; remains open for phase 5.
- Report Moxfield access/relay hurdles before selecting infrastructure. Historical HTTP 403 and EDHLAB relay observations need current verification. Do not bypass access restrictions.
- PRs #210, #217, and #219 are now merged, with individual approval from the prior release request. No future PR has merge approval.
- Local Docker is the reviewed main build. Post-merge baseline: 510 unit tests; 25 browser passes and 2 existing fixture skips. Main image publication succeeded, revision verified.
- #220 workaround is in PR #221 at `bf6813f`, awaiting individual merge approval. Reproduced in serial mixed runs (1/10, then 2/20); a failed transition had a completed 39.5 ms RSC response and prefetch suppression still failed 1/20. Exact framework-internal mechanism is unproven. Advanced filters now use document GET navigation with scroll/panel restoration and Back/Forward coverage. Full verify passed: generation, typecheck, 510 unit tests, host build, 25 browser passes / 2 existing skips. Production Docker rebuilt and healthy. Final mixed stress repetition remains in progress. See `INVENTORY_FILTER_NAVIGATION.md` and `LOCAL_REVIEW_BUILD.md`.
- Final #221 mixed color-filter stress run: 20/20 passed, unchanged timeout. Next: #215 owner-scoped full-page benchmark, lazy location editors, and bounded searchable storage navigation.
- #215 implementation: 25-card pages, path/type/branch search, paged tree levels and breadcrumbs, one explicit editor, full-tree counts. First targeted run: 5/5 browser tests; new 1,200-location/150,000-copy fixture loaded in 1,098 ms with 1.16 MB DOM HTML versus 8,021 ms / 32.2 MB at only 300 locations before the fix. 515 unit tests passed. Final Docker build with phone refinements is healthy; full verify in progress. See `LOCATION_BROWSER_SCALE.md`.
- User identified EDHLAB as https://edhlab.gg/. Its public client delegates Moxfield to Supabase functions; no evidence of upstream permission/mechanism. Current single direct Docker request to a public precon reconfirmed HTTP 403. Details in #190. Asked whether to draft a developer-access request or whether the user already has approved access. Do not reuse EDHLAB's service/credentials or bypass blocks. Continue independent work.
- During phase-5 planning, found the library search applies its 50-card cap before matching; catalogued as #222 for the next playtest batch. #167 remains the phase-5 parent; do not close it until all scope is actually delivered.

## Historical batch (completed and merged)

- Branch: feature/inventory-move-experience, based on feature/vault-inventory-pilot.
- Issue: #218, inventory move polish and Explorer-style selection.
- PR: #219, verified for local review and stacked on #217.
- Dependencies: open PR #210 (setup) and #217 (vault pilot). Neither is approved to merge.
- Implemented: focused move dialog, integrated keyboard-searchable destination list, section occupancy cards, dynamic fill/all/85/custom quantity modes, review summary, tucked-away deletion, Ctrl/Meta and Shift selection in displayed order.
- Card names and Binder cards retain plain-click details; modifier-click and checkboxes select. Table non-control row click selects; unrelated links/buttons preserve their own behavior.
- No outstanding product question for this batch.

## Verification / next safe step

- Typecheck, 510 automated tests, and host/Docker production builds have passed during verification.
- Final browser suite at application/test revision 4801f78: 25 passed, 0 failed, 2 pre-existing fixture skips. Desktop/phone screenshots inspected; temporary fixture counts are zero. See LOCAL_REVIEW_BUILD.md for exact image and coverage.
- Earlier full verify had an intermittent color-filter navigation timeout; the unchanged test passed on the final full browser rerun. Issue #220 remains open for diagnosis, not claimed fixed.
- The next independent audit candidates are #220 (filter navigation) and #215 (large-tree navigation/editors). Read relevant Foundry notes and live GitHub status before starting a new batch.
- Preserve the cumulative Docker review build and keep PRs reviewable while continuing authorized work.
- Never merge any PR without individual user approval.

## Resumption rules

Read AGENTS.md, the Foundry hub/workflow/feature notes, and this checkpoint. Inspect git status, open PRs/issues, and container/process state. Preserve unrelated changes. An interrupted command is not evidence of success; confirm its result before repeating operations.

If an answer is required, record the specific question and ask in the active project chat. Continue independent, authorized work from the queue while awaiting input. Recurring execution is not configured; this file does not create an automatic runner.
