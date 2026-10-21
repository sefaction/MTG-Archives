# Scan destination free-space filter (#855)

Base: `8ad7cd949b034226a10a2b21f2a3cdbd9abdd155` (`origin/main`).
Branch: `codex/issue-855-capacity-filter`.

Scan batch setup has an optional **Only destinations with free space** checkbox,
off by default. With it on, any positive available space qualifies, even when
the entered batch quantity is larger. A location qualifies through a configured
overall limit with room, or a configured section with effective room (including
Vaults with no overall limit). Named sections require their own configured limit;
an unknown section is hidden even when its parent has a known limit. **No section**
uses the overall location limit. The parent's tighter bound always applies.
Unconfigured custom-section entry is available again when the filter is off.

Stored copies and held batch reservations consume room. The list uses the existing
`max(reserved, candidates, slots) - committed` rule, grouping receipt counts in
PostgreSQL rather than loading individual historical receipt rows. Pending-only
custom section names consume parent room without adding ordinary option names.
Photo setup and existing-batch pages do not load this new advisory snapshot.

The current selected destination/section and hidden form values survive filter
toggles and capacity changes. A hidden selection is described explicitly; the
picker never chooses a replacement. Start, reservation and Inventory commit
authorization/locking/overfill controls are unchanged. Existing selected-destination
capacity polling also runs while the filter is enabled; **Refresh capacity** reloads
the entire advisory list. A list can become stale between reads; Start and Inventory
addition retain their authoritative fresh checks.

Only scan setup opts into the new picker mode. Private/public Inventory, League,
trade and ordinary import picker callers retain their previous mode. No trade or
CSV import files changed. `components/StorageDestinationPicker.tsx` is shared and
is the potential integration overlap with the parallel #834 worker.

## Author evidence

- 12 focused Node tests pass: the new predicate/list tests plus existing scanner
  reservation and storage-section/move tests. Cover positive/zero/negative room,
  unknown capacities, mixed sections, parent limits, held space, receipt deduction,
  unchanged original objects and ordinary option names.
- 13 existing Start recovery, continuation and handoff-admission safeguards pass.
- Standalone real React picker browser tests pass at 1366x844, 390x844 and 320x844.
  Cover default off, restore-all, one free slot with incoming quantity 10, keyboard
  checkbox/Enter/Escape, hidden sections/custom entry, refresh-to-full, retained
  hidden form values/callback count, empty results and no horizontal overflow.
  Ordinary picker mode retains its existing section-only filter. Phone screenshots
  were visually inspected; captures are in ignored `test-results/scan-filter*.png`.
- `tsc --noEmit --incremental false` passes. Initial typecheck lacked the already
  locked `stream-json` dependency in the primary checkout's dependencies. Exact
  installed `stream-json` 3.7.0 and `stream-chain` 4.2.6 were copied into this
  worktree's ignored node_modules; no package or lockfile change was made.
- Independent source review found and verified fixes for initial per-candidate
  materialization and pending-only option expansion. Revised source has no remaining
  concrete finding; the reviewer independently reran all 12 focused tests and a
  pending-only-section oracle. Independent review does not include browser or DB.
- `git diff --check` passes.

The initial sandboxed fixture compilation could not read an ancestor directory;
the same scoped compilation succeeded with escalation. No shared app was involved.
Full application/browser, real database execution of the new query, production
build, exact-head CI and named-installation/user acceptance are not established
by the standalone tests. The separate active issue-worker owns the shared lock;
this work never acquires/releases it or changes shared services, data, Inventory,
credentials or resource settings. No physical scanning, merge or deployment.

## Reproduce standalone UI checks

From this worktree with its locked dependencies installed:

```powershell
New-Item -ItemType Directory -Force .local-data | Out-Null
npx esbuild ./tests/ui/scan-destination-filter.fixture.tsx --bundle --platform=browser --jsx=automatic --outfile=.local-data/picker.js
npx tailwindcss -i app/globals.css -o .local-data/picker.css --minify
$env:MTG_PICKER_FIXTURE_JS = (Resolve-Path .local-data/picker.js).Path
$env:MTG_PICKER_FIXTURE_CSS = (Resolve-Path .local-data/picker.css).Path
npx playwright test tests/ui/scan-destination-filter.spec.ts --workers=1 --reporter=list
```

The fixture bundles the actual shared component and uses the application's CSS.
It sets page content locally and sends no HTTP requests to the application.
