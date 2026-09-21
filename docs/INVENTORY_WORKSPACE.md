# Real Inventory workspace pilot

Approved sequence, 2026-09-21: shared sidebar and real Inventory, then real Locations, cumulative local Docker review. This is the first application batch after the synthetic design in PR #276. Individual PR merge approval is still required.

## Retained homes

- Signed-in Archive routes share grouped desktop navigation and a shallow labelled phone menu. Dashboard, Inventory, Locations, Import, Decks, Wishlist, Trades, Pricing, Public, Settings and authorized Admin remain directly available; Commander League has an explicit separate-workspace link. Account/password, notifications, admin-mode controls and logout retain their original server actions and authorization.
- Private Inventory keeps the existing server queries, API, exact/grouped modes, table/binder views, persisted columns/card sizes, pagination/infinite browsing, details and mutation callbacks. Secondary display controls and Columns are under **View options**.
- One card-name draft is shared by quick search and structured Apply. Quick Search includes the structured draft, even after closing the panel. Clearing a URL chip or Clear Filters operates on applied criteria. Back/Forward reinitializes structured controls from the server search; quick search uses client push with scroll restoration, while advanced Apply retains its existing read-only GET document navigation.
- Desktop filters sit beside results; phones use a bounded native modal dialog with Close/Apply, Escape and focus return. Closing does not reset drafts or selection. Structured fields precede the optional local Scryfall expression. Invalid expressions reopen the phone panel and show an error above the fields.
- Active chips remain outside the panel. Results identify matching results separately from physical copies. Batch actions are contextual; all-matching selection explicitly includes physical-copy count. Existing modifier/range selection, partial moves, reservations, provenance, owner isolation, audit records and advisory six-section vault maps are unchanged.
- Admin zero-quantity cleanup remains available under **Inventory Maintenance**. Anonymous navigation, public read-only capabilities and the separate League shell remain intentional; public filters retain the existing collapsible form (with truthful no-active-filter copy and structured fields before the expression).

## Verification and boundaries

The owned-fixture browser scenario is `tests/ui/inventory-workspace.spec.ts`. It covers the navigation/current route, first-viewport table, non-displacing side filters, shared drafts in both submit directions, Back/Forward rendered results, selected-copy context, desktop Apply visibility, view controls, six-theme reflow, 390/320px phone dialogs, invalid-expression feedback and Account form width. Existing filter, public detail, export, vault and broader lifecycle scenarios remain regression gates.

Exact commits, images, PRs and completed checks are recorded in `WORK_CHECKPOINT.md`; ignored screenshots/logs stay under `test-results`. Final local verification passed 569 units and all 42 serial browser cases without skips, plus Windows/Linux builds and manifest guards. It includes the existing 1,200-location / 150,000-copy smoke fixture (3,000 stacks of one printing), not a full four-owner realistic-printing-cardinality benchmark. No authenticated traces or real collection screenshots are published. This pilot does not certify every route/theme contrast or keyboard/zoom combination.

Reliability #220 and #260 remain separate and unresolved. The unchanged vault-map test reproduced #260 during this batch: after a reported successful partial move, Sect 0 still displayed zero at its original ten-second assertion. Passing subsequent runs cannot establish a fix. No timeout increase, reload workaround or backend move/revalidation change is included.

Next application batch: browse-first real Locations (#266), followed by the remaining capability/acceptance work in #263–#265/#274. This pilot does not close those umbrella work packages wholesale. The shared misleading filter-summary copy is addressed for #275.
