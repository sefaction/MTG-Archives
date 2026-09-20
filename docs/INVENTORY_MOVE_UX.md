# Inventory selection and move experience

Follow-up to the vault pilot; tracked in #218 and delivered for local review in PR #219.

## Interaction

In Exact printings Table View, click a non-control area of a row to replace the selection. Ctrl-click (or Command-click) toggles a row; Shift-click selects the displayed range from the anchor; Ctrl/Command+Shift adds a range. A printing selects all of its underlying stacks. Checkboxes are additive and support Shift. Focused rows support Space/Enter with modifiers.

Ranges cover the current page or the currently loaded infinite-scroll rows, not unseen inventory. Filtering, sorting, navigation, refresh, and Clear selection reset the anchor. Explicit “Select all matching filters” is still available; subsequently selecting individual rows exits that cross-page scope.

Card-name buttons and Binder cards retain ordinary click-to-open details; Ctrl/Command/Shift-click selects instead. Other links and row actions retain their own behavior. Checkboxes remain available on touch devices.

The selection toolbar stays available while browsing. **Move cards…** opens a native modal dialog with keyboard focus containment, Escape/Cancel dismissal, and preserved selection on cancellation. Deletion is kept under More actions, away from the move confirmation.

## Moving

1. Search and choose a destination in one control. Full storage paths and current counts appear in the results. Up/Down and Enter work without submitting the enclosing form. Results are capped at 30; narrow the query for additional matches.
2. Choose a section using occupancy cards, choose No section explicitly, or enter a custom label. Capacity is advisory. “Only sections with room” keeps unlimited custom sections available.
3. Choose all copies, 85, fill remaining space, or a custom maximum. Fill stays linked to the currently selected section. Copies already there are excluded from an exact selection's preview.
4. Review the destination and quantity in the persistent footer, then move. Server errors stay within the panel; successful moves clear selection, refresh counts, and preserve browsing context.

All-matching quantities are upper limits because the server evaluates the full filter at submission. Reserved quantities, identity preservation, stale-selection checks, ownership boundaries, and transaction semantics remain in the existing storage-move service.

The destination control is shared with manual add and import review. It does not create locations or silently map custom section labels.

## Verification

- Pure selection tests: forward/backward ranges, shrinking ranges, additive selection, multi-stack printings, missing anchors/targets.
- Opt-in local Docker browser regression: search/no-results, cancellation and focus restoration, section switching/fill, custom labels, advisory overflow, stale selections, real moves and copy conservation, cross-page totals, row/checkbox/card-name/Binder/keyboard range selection, page reset, manual-add picker fields/preview, desktop and phone layout.
- Full suite, exact deployment evidence, and any remaining gaps are recorded in LOCAL_REVIEW_BUILD.md after validation.
