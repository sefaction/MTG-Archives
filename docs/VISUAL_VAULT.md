# Visual vault workspace

Issue #240. Vaults retain the existing case-insensitive `Vault` type and virtual defaults `Sect 0` through `Sect 5`. No schema migration, placement rewrite, capacity enforcement or new movement transaction is introduced.

## Interaction

- Locations and single-vault Inventory show the six sections left to right in one physical row. Each shows direct physical-copy occupancy, remaining room, or advisory overflow above 85. Totals ignore card-search filters and descendant locations.
- A section link browses its exact label. Unsectioned combines null and empty-string placements. Arbitrary extra labels remain separate. Other search filters remain active; changing section resets pagination and selection.
- With inventory selected, each destination offers **Move here**. This presets the existing move-review dialog, including custom amounts and remaining-space choices; it does not immediately mutate inventory. Cancellation retains selection and returns focus.
- On phones, only the tray scrolls horizontally. The active section is brought into the tray viewport without vertically jumping the page. Keyboard links, focus indicators and occupancy accessible names remain available.

## Filtering and access

`locationSectionMatch=exact|empty` is shared by inventory page/API, exports and matching-selection mutations. Omitted/unknown modes keep legacy case-insensitive substring search. Advanced Search exposes all three modes and removable filter chips. Exact labels use the same case-sensitive identity as stored section counts.

The map uses existing access-scoped storage summaries; it adds no aggregate query. Public read-only inventory has no map/move controls. Existing owner/admin capability and mutation validation remain authoritative.

## Regression coverage

- `tests/vault-navigation.test.ts`: navigation, parameter preservation/reset, exact versus empty semantics and owner predicates.
- `tests/ui/vault-map.spec.ts`: disposable 263-copy/two-owner fixture; single-row geometry, 68/85/90 occupancy states, Sect 1 versus Sect 10, null/empty browsing, cancel/focus, partial and matching-filter moves, refreshed counts, copy conservation, private-owner denial, 390px phone containment/active-section scroll and Locations parity.
- `tests/ui/vault-pilot.spec.ts`: existing advisory overflow, selection, move, stale/error and phone regressions retain coverage with the new presentation.

These are bounded regressions, not proof of every device, arbitrary label length, collection distribution or concurrent action. Existing 150,000-copy storage-summary fixtures cover aggregation scale; the new browser fixture emphasizes interaction and correctness.

Validation/runtime evidence belongs in LOCAL_REVIEW_BUILD.md and WORK_CHECKPOINT.md. All PRs still require individual merge approval.

## Open observation

The first browser lifecycle reported a successful matching-filter move but retained the old destination occupancy for over ten seconds. Issue #260 records this intermittent mutation-refresh observation separately from filter navigation #220; a focused rerun and five repetitions passed, which does not establish a fix. Keep the UI assertion before database verification so diagnostic work cannot mask refresh timing. No timeout was increased.
