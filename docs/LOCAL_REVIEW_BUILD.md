# Local review build — cumulative issue queue

## Autonomous batch 1: import integrity, 2026-09-23

- Local review: http://127.0.0.1:13001/imports. Application `8a3279c`, branch `fix/import-commit-integrity`, main base `bfb7be8`; PR publication/CI tracked in WORK_CHECKPOINT.md. Acquisition docs PR #315 is separate and not in this image.
- Healthy rebuilt web image `sha256:a8354882a61ca00a8ba2a9410f5436b410cdd57a207bcba947677c3b51355883`; base/local/capture-only SMTP overlays. Pricing and notification workers retain their prior images, since this batch changes the web importer only.
- All 580 units, typecheck, Linux production build and seven manifest guards passed. Eight real PostgreSQL scenarios cover concurrency/fault rollback/retries/audits/attributes/undo; final browser Imports lifecycle passed (including phone, six themes, enlarged text and access boundaries).
- Review a CSV with resolved rows, confirm/cancel its commit, check exact stock plus `import_committed` audit records, retry the same batch, and review admin undo. Undo retains zero inventory rows and audits; changed/missing/legacy Pull-linked rows require manual review. See IMPORTS_WORKSPACE.md for transaction semantics and repeatable test command.
- No merges, issue closures, schema migrations, acquisition/playtest changes or production deployment.


## Deck builder workspace, 2026-09-22

- Review: http://127.0.0.1:13001/decks (open an existing deck).
- PR #294, branch `feat/deck-builder-workspace`, application `82f8fac`; includes main `5a8b77c` with merged #288/#291. #294 remains unmerged and needs its own approval.
- Current web image: `sha256:cf5ea7aa2a6c7d91b1c0f4a570f189f9c48fae938dffced054ff79642fe0d2d4`. Healthy, host login HTTP 200; base/local/capture-only SMTP overlays unchanged.
- Compact identity and optional art/coverage move the same deck's builder from y=629 to y=350 at 1366x768. Add/Paste are direct; options/selection use native dialogs and tools return to the same deck.
- Full verification at `808e07c`: 577 units, Windows build/seven manifest guards and 49/49 browser cases. Final CSS-only polish `82f8fac`: Linux build/seven guards, required CI 35753238095 and both affected Decks cases passed. Full suite not repeated after the final CSS refinement. See WORK_CHECKPOINT.md for coverage and limits.
- Snapshot cleanup verified: 12,477 physical copies, no fixture users/players/uploaded batches. No migrations or production deployment. #268's library/playtest portions and known #220/#260/#280 remain open.


## Current Imports and Locations review (2026-09-22)

Cumulative unmerged PRs **#288 → #291**, application `3c98f44`, image `sha256:96ed4194f8d6f344a43c84a28d8791dc59fd8e5610184de03857e925cdfd3676`. Healthy and host HTTP 200. Review [Imports](http://127.0.0.1:13001/imports) and [Locations](http://127.0.0.1:13001/locations). Each PR requires individual merge approval.

#288 preserves inactive parents during metadata edits and parent selections after saves. #291 separates CSV capture, manual add, export and history; batch deep links open review with copy/row totals, reachable destination/commit, contextual printing resolution and themed controls. See IMPORTS_WORKSPACE.md for capability homes and draft behavior.

577 units, typecheck, Windows/Linux builds and manifest guards passed. Full browser run: 44/47, including two obsolete test locators and another known #260 stale-occupancy observation. Corrected/refined code then passed all 14 affected cases, followed by all five final affected cases after the scoped contrast adjustment. Desktop, phone, actual six themes and enlarged-text screenshots/checks passed. Full 47 not rerun after final refinements; #260 remains unresolved despite the later passing vault case. Exact evidence is in WORK_CHECKPOINT.md and the PRs.

Fixture users/players/uploaded test batches are zero; snapshot retains 12,477 copies. Local SMTP capture is retained. No production deployment, schema migration or merge.

## Current visual vault review (2026-09-20)

Cumulative stack #243 → #244 → #247 → #248 → #250 → #254 → #255 → #259 → #261, application/test `1d3330e`. Current local image `sha256:563b5245782bc484d84c97ec2a06ff52126adddec6b83e7dfc35ed024af4c46e` is healthy/host HTTP 200. No pending PR has merge approval. #261 remains draft while intermittent stale move occupancy #260 is investigated; no production change.

Full verification PASSED: generation/typecheck, **568 units**, Windows/Linux production builds/six manifest guards, **all 41 serial browser cases, zero skips** (3.5m). Linux CI run `35529120610` passed. The final map lifecycle passed in 5.9s; desktop and two phone screenshots were inspected. The original vault pilot and 1,200-location/150,000-copy scale fixture also passed. Fixture users/vault locations returned to zero and original inventory remains **12,477 physical copies**. Capture-only SMTP overlay and the disabled local trade announcement endpoint are preserved.

One initial map lifecycle failed a 10-second occupancy refresh assertion after a successful all-matching move. A focused rerun, five repetitions and final full run passed; this is **not a claimed fix** for #260. The final test preserves the UI assertion before DB verification; no timeout was increased. Logs are ignored locally: `vault-browser.log`, `vault-map-recheck.log`, `vault-map-repeat.log`, `vault-final-docker.log`, `vault-full-verify.log`.

To review, browse a location with type Vault from Locations or filter Inventory to one vault. Click a section to browse its exact cards, select inventory and choose **Move here** to review a destination. Counts show direct physical copies, not distinct printings or filtered totals. Custom labels and unsectioned cards remain accessible. See VISUAL_VAULT.md and WORK_CHECKPOINT.md.

## Previous League lifecycle review (2026-09-20)

Cumulative stack #243 → #244 → #247 → #248 → #250 → #254 → #255 → #259, application `76f0d8b`. Local image `sha256:14cd31c69a66501c5a5378257047c29e297cb606c82a7572e8375f79ce4f34de` is healthy/host HTTP 200. #259 adds full League lifecycle acceptance and fixes empty games from malformed counts (#257) and stale validation feedback (#258).

Full verification PASSED: 563 units, generation/typecheck, Windows/Linux builds and six manifest guards, all 40 serial browser cases with zero skips (4.3m). Fixture users/leagues were removed and inventory remains 12,477 physical copies. See LEAGUE_LIFECYCLE.md for the normal/failed/corrected evidence and boundaries. Same capture-only SMTP overlays; no pending PR has merge approval and no production change occurred. Draft visual-vault files are not in this build.

## Previous login-return review (2026-09-20)

Cumulative stack #243 → #244 → #247 → #248 → #250 → #254 → #255, application `45bf2de`, test correction `e53fa28`. Local image `sha256:4db6c0bce174b5a6e7530479befda95a3ed4a5ca13f4607b27dca05bbe0a5fd2` is healthy/HTTP 200. #255 validates local login/admin-mode return paths and preserves requested destinations across login retries; see LOCAL_RETURN_PATHS.md.

Final full verification PASSED: 561 units, generation/typecheck, Windows/Linux production builds and six manifest guards, all **39 serial browser cases with zero skips** (2.8m). Initial run had 38 passes and one outdated email-test redirect expectation; the correction also fixes fixture teardown #256, with a clean focused and full retest. Auth/login/email/trade fixture users returned to zero; physical inventory remains 12,477. Same capture-only SMTP overlays and disabled local trade announcement endpoint; no production change and no pending PR has merge approval.

## Previous session-security review (2026-09-20)

Released main remains `e98266f`. Cumulative local stack: #243 → #244 → #247 → #248 → #250 → #254, application `cd5c469`. Image `sha256:5785e72f1b7a74107878ae5215f7070a0b7b4f67abd49f31c444666b89b44d90` is healthy and host HTTP returns 200, with all 59 migrations current. Preserve the three Compose overlays and capture-only SMTP. One local trade-announcement endpoint remains disabled for safe fixture testing.

The authentication change requires existing browsers to sign in again. No passwords or collection data were changed by migration. All 558 unit tests/typecheck, Linux CI and Docker build/manifest guards passed; all three dedicated security browser cases passed in 20.9 seconds. Synthetic session/trade account counts returned to zero and the snapshot still contains 12,477 physical copies. Full cumulative verification also PASSED: generation/typecheck, 558 units, host production build/six guards and all 37 serial browser cases with zero skips (3.1m). No new PR has merge approval and no production deployment occurred.

See AUTH_SESSIONS.md for expiry/revocation, account-edit behavior, HTTPS requirements and restored-session safety. See TRADE_LIFECYCLE.md for the complete two-user trade acceptance and provenance/history fixes in #250.

## Previous reliability review (2026-09-20)

Released main is `e98266f`. Pending stack #243 → #244 → #247 → #248 is loaded cumulatively from `01e7ee3` (same tree as gate-backfill merge `1d06bb3`). Image `sha256:0945717dd1ca31cbd81b629b284a476286e7af7e5930c4e8cc9f1c85fecfb4e5`, Next build `QE7rEpiwJg1USCIdO3Oul`, healthy with host HTTP 200. All three Compose overlays remain in effect and SMTP stays capture-only.

Full verification passed: 550 units, generation/typecheck, Windows/Linux builds and six client-manifest guards, all 33 serial browser cases with zero skips (3.2m). Every pending branch also passed its own Linux GitHub core gate. Final isolated rebuilt-image recovery passed; see BACKUP_RESTORE_DRILL.md for data and coverage limits. No new PR has merge approval; no production changes or auto-merge.

## Historical pre-release stack through #236

Current deployment: 2026-09-20, application revision `dad1bd3`. Stack: #221 → #226 → #227 → #228 → #229 → #232 → #233 → #234 → #236, based on released main `9a3fd8b`. Every PR awaits individual merge approval; no production update.

- App http://127.0.0.1:13001; local-only SMTP capture http://127.0.0.1:18025 (no relay).
- Compose overlays: common + local + `docker-compose.smtp-test.yml`. Normal deployments still default SMTP off.
- Docker image `sha256:7247503387af017aa862c9c9c1750637bee9d57c41b1b0ed7945a7fcf583698e`; Next build `29QGmn8T55qnVQuSACupv`. Healthy, host HTTP 200, 58 migrations current.
- Docker build/client-manifest guards and production dependency audit pass (zero known vulnerabilities). SMTP real queue failure/retry/capture/opt-out and private settings browser checks passed. Four detail tests pass, including meld, Escape/focus/background inertness, public capabilities and phone layout; screenshots inspected.
- Full cumulative verification PASSED: generation/typecheck, 537 unit tests, host build/manifest guards, all 33 serial browser cases with zero skips (2.9 minutes); see WORK_CHECKPOINT.md and `test-results/audit-verify.log`. Earlier SMTP full run had one advanced-search timing failure, recorded on #220; isolated private/public recheck and final full run passed without changing timeouts. This does not prove intermittent timing risk eliminated.
- Historical detail/meld skips below were attributed to missing admin fixtures at the time. Audit #235 found the locator itself was also wrong (summary queried as button). #236 replaces those silent local skips with deterministic owned fixtures; do not count historical skipped cases as passes.

Review the stacked improvements: searchable paged Locations, advanced inventory search, pasted decklist commander/printing review, advanced manual playtest controls and safe device-local sessions, Settings → Email notifications, and keyboard-accessible inventory details. Feature/deeper audit boundaries are mapped in FEATURE_COVERAGE.md.

## Historical bounded location browser build

Current deployment: 2026-09-19, application/test revision `97a0095` on #221 (`60892f0`).

- URL: http://127.0.0.1:13001
- Includes unmerged filter navigation #221 and location browser draft PR #226 (#215). No new merge approval.
- Clean Linux running image: `sha256:fc27cb412fda5bd9ccd84188a03abb061fe15b80935c309268d352565cf4b430` (config `b8a64f08b4e2e034129ea2edda4013ebc9642993160dab4c88df63c8f18f5b61`); Next build `JTlVHHQw8QcZdReqSHUn0`.
- Generation, typecheck, 515 unit tests and host production build passed. Final browser rerun: 24 passed / 2 failed / 2 existing skips (2.7 minutes). Both failures are Scryfall query latency #224. Do not represent this as a passed release gate.
- A prior Docker image omitted the Imports manual-add client reference (#223). Rebuilding unchanged application code restored it; Imports/export and hierarchy tests passed afterward. This recovery does not prove a permanent compiler fix.
- Location scale regression passed: 1,200 synthetic locations / 150,000 physical copies; latest run 1,409 ms to heading, 1,165,155 bytes serialized DOM, 3,615 options. See `LOCATION_BROWSER_SCALE.md` for limitations and baseline. Desktop and phone screenshots inspected.
- Review Locations: search paths/types, browse a branch and breadcrumbs, page through cards, and select Manage to open one editor. No schema change.

## Previous advanced-filter review

Current deployment: 2026-09-19, application/test revision `bf6813f`, [PR #221](https://github.com/sefaction/MTG-Archives/pull/221) on released main `9a3fd8b`.

- URL: http://127.0.0.1:13001
- Unmerged batch: #221 only. Earlier PRs #210, #217, and #219 are merged.
- Web image: `sha256:04edc35fb2feee192d3796c47780f2fe942111c3d75d3f038f5fe1f811b4caea`
- Next build ID: `SjrBpnq2d-z2BwmyPbavB`
- Docker production build passed; container healthy and host login returned HTTP 200.
- Full verify passed: Prisma generation, typecheck, 510 unit tests, host production build, 25 browser tests, and 2 existing fixture-dependent skips. No build overlapped browser testing.
- Final mixed color-filter repetition: 20/20 passed with the unchanged 10-second URL assertion (1.2 minutes overall). See [INVENTORY_FILTER_NAVIGATION.md](INVENTORY_FILTER_NAVIGATION.md) for diagnosis and the deliberate full-navigation tradeoff.
- Review: apply White + Blue exact-color filters, check chips, then Back and Forward. Panel state remains expanded. This PR awaits individual merge approval.

## Historical inventory move experience review (now merged)

Verified 2026-09-19 on this laptop. Local review deployment only; no merge or production release.

- URL: http://127.0.0.1:13001
- Application/test revision: `4801f783c465c14fe3fb9940b675f27d888fa191`
- Included unmerged PRs: [#210](https://github.com/sefaction/MTG-Archives/pull/210), [#217](https://github.com/sefaction/MTG-Archives/pull/217), [#219](https://github.com/sefaction/MTG-Archives/pull/219)
- Included setup commit: `266a888bd805b9e85663e5e1964c29e69295804d`; vault pilot application commit: `92265999654a2e789e629f47fdcb5223daca560a`.
- Web image: `sha256:452a1aa917ce6597d12f1ae92eb5a495f4736c8def8d84d72dfe71c681d26fac`
- Next build ID: `jgS7PW_2ij-FxHHeIVmzW`
- Container healthy; host login URL returned HTTP 200.
- No schema migration or bulk reassignment. Docker service containers were rebuilt with persistent snapshot data preserved.

## Validation

- Prisma generation, typecheck, 510 automated tests, and host production build: passed.
- Final Docker production build: passed.
- Final serial browser suite: 25 passed, 0 failed, 2 skipped in 2.0 minutes. No build ran concurrently with browser tests.
- Typecheck rerun after final browser-test additions: passed.
- Existing inventory-detail/meld tests still skip because their admin fixtures are absent. These are coverage gaps, not passes.
- Expanded local regression covers real copy-limited moves/conservation, stale errors in the dialog, owner isolation, full/empty/overflow sections, dynamic fill, custom quantity and section labels, keyboard destination choice, no-result behavior, cancel/Escape/focus restoration, table rows/checkboxes/card names/Binder modifier selection, page reset, and cross-page totals.
- The shared manual-add picker was exercised without submitting inventory: destination/section form fields and quantity-dependent preview were verified.
- Desktop, phone section/overflow, and phone quantity screenshots were visually inspected.
- Fixture audit after tests: zero UI vault pilot locations, inventory rows, or players remain.

An earlier full verify run passed generation, typecheck, all 510 tests and production build, but its browser phase had 24 passes, 1 exact-color-filter timeout and 2 skips. The unchanged color-filter test passed in 2.0 seconds on the final full browser rerun. [Issue #220](https://github.com/sefaction/MTG-Archives/issues/220) tracks that intermittent navigation behavior; it is not claimed fixed by #219. Timeouts were not loosened.

The pilot's earlier real-PostgreSQL reservation/concurrency and 150,000-copy summary evidence remains documented in [VAULT_PILOT.md](VAULT_PILOT.md). This UI batch is not a new full-page scale benchmark or a complete import-commit audit.

## Review

Open Inventory in Exact printings mode. Click a row, Ctrl-click to toggle, or Shift-click to select a displayed range. Choose **Move cards…**, search for a vault, select a section, and try **Fill remaining space**. The footer shows the actual selected-copy estimate and any capacity warning. Cancel keeps the selection.

Normal card-name/Binder clicks still open details; modifier clicks select. Ranges cover the current page or loaded infinite-scroll rows, not unseen pages. **Select all matching filters** remains explicit. See [INVENTORY_MOVE_UX.md](INVENTORY_MOVE_UX.md).

PR #219 is stacked on #217, which is stacked on #210. Individually approve and merge prerequisites first, then retarget dependent PRs to main and recheck before their separate approvals. Do not merge #219 into the feature branch or #217 into the setup branch. No merge or auto-merge has been performed.

Next audit candidates are intermittent filter navigation (#220) and large-tree navigation/editors (#215). Scheduling remains unconfigured; resumable state lives in [WORK_CHECKPOINT.md](WORK_CHECKPOINT.md).
