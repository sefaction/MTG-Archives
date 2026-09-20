# Local review build — bounded location browser

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
