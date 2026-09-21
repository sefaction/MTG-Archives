# Design acceptance ledger

Baseline app: `7a32dd3`; design branch `design/ui-consolidation-foundation`, 2026-09-21. This document separates past observations, synthetic prototype checks and required future application acceptance.

## Before / proposed / evidence

| Task | Existing evidence | Proposed behavior | Acceptance status |
| --- | --- | --- | --- |
| Reach Inventory/Locations/Decks | Flat navigation, ten peers; source and prior live audit | One direct destination in either navigation alternative; shallow phone menu | Prototype to verify |
| Search and refine | Prior 1511×896 audit: expanded Apply at document y≈1127, table y≈1399; collapsed table y≈707 | Search/chips above results; desktop filter panel beside results | Real prototype dimensions/coordinates to record; not a matched before/after benchmark |
| Select and move 17 copies into 17 spaces | Existing Ctrl/Shift, exact stack semantics, shared move dialog; historical vault tests | Contextual selection count and integrated 68→85 review | Synthetic flow to verify; real transactions remain future gate |
| Browse storage | Prior audit: Normal locations heading y≈2938, page ≈5978 px | Search/tree and selected vault first; management contextual | Prototype dimensions to record |
| Navigate deep locations | Historical 1,200-node fixture; not a varied-printing 150k-copy benchmark | Search full paths, preserve branch and edit context | Three-path prototype only; large-tree proof pending |
| Preserve all features and scopes | Source route/action map; historical 568-unit/41-browser release evidence | Every route/action retains a named home and current guards | Route enumeration check; action/role implementation evidence pending |

No current-user timing or click savings are invented. Re-run the same tasks at matched widths/data with an observer before claiming faster task completion. Prototype sample steps can establish interaction counts only for that sample, not production efficiency.

## Required implementation gates

- Desktop: actual 1366×768 and 1440×900; identity, search, primary action and beginning of Inventory/Locations content above first fold. Advanced filters do not displace results by a whole page.
- Phone: actual 390×844 and 320 CSS px; no page-level overflow; six sections in one locally scrolling row; searchable destinations, errors and confirmation reachable without clipping.
- Keyboard: finish search, filter/chip removal, selection, move cancellation, detail dismissal and navigation; visible/unobscured focus, Escape and focus return; no hover-only essentials. Test 200% zoom, touch targets, long labels and all six theme contrasts.
- States: empty, loading, failed filter, stale selection, reserved copies, cancellation, move success/error, many chips, long names, all-matching and selection outside visible results. No accidental re-submit on rerender.
- Scope: owner/non-owner, signed-out/signed-in public, admin inactive/active, League member/organizer/frozen deck. Keep public trade-wishlist action while withholding owner inventory mutations.
- Scale: roughly 150k copies with realistic card/printing/stack diversity, hundreds of locations/thousands of children, four uneven users. Existing same-printing scale fixture is useful but insufficient.
- Reliability: diagnose #220 and #260 without increasing existing timeouts or adding reloads that hide stale UI. A passing rerun does not close either issue.
- Application validation: relevant tests from CAPABILITIES.md, required CI, production build guards, affected real Docker browser flows. User layout review and individual PR merge approval.

## Current review boundary

The prototype cannot prove database conservation, authorization, accessibility conformance, large-collection performance, persistence or real route transitions. It does let the user compare navigation, control placement, focus/cancellation behavior and a consistent synthetic move. Full filter syntax, binder/grouped layouts, destination search and specialist workspaces remain later designs. No implementation issue is marked complete from this batch.

## Verification record

Passed `node docs/design/ui-consolidation/qa.mjs` on 2026-09-21: all **34 page routes** have a crosswalk entry; **164 targeted checks**, no captured JavaScript exceptions. Both layouts were exercised at real 1366×768, 1440×900, 390×844 and 320×844 viewports; all six themes were checked for page overflow. Dialog cancellation/Escape returns focus; selection, Shift ranges, all-matching, hidden selection disclosure, search/chip removal, empty results, screen Back navigation, advisory overflow and the 17-copy move passed. The synthetic total remained 370 after movement and the destination showed 85. Static-server allowlist and no-network CSP checks passed.

Desktop content coordinates (including the 58px prototype review bar): sidebar Inventory table y=344, Locations tray y=325; top navigation table y=395, tray y=376 at both desktop widths. Opening desktop filters left the table's y coordinate unchanged. These are synthetic prototype measurements, **not matched performance improvements over the prior audit**. Phone Inventory starts at y=588 and Locations tray y=754, including the 168px review controls; the tray/table scroll locally. There is room for further phone hierarchy refinement after the layout choice.

Inspected screenshots for both desktop navigation alternatives, expanded desktop filters, phone Locations and the 320px move dialog. Screenshots/results stay under ignored `test-results/design-review`; only synthetic data is rendered. An initial phone overflow caused by absolutely positioned table accessibility labels was corrected by containing them within the table scroll region, then the full targeted check passed.

Checked JavaScript syntax, formatting and git whitespace. The preview was also opened and its Inventory controls/data verified in the connected Chrome browser. Automated contrast, 200% zoom, a complete keyboard-only journey, real role variants and production parity remain pending. Existing application full regressions are not required for this isolated static preview and are not claimed rerun.
