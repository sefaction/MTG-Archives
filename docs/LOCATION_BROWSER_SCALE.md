# Location browser scale audit (#215)

## Design

- Search full owner-scoped location paths and types, optionally within a selected branch.
- Render up to 25 location cards and 25 immediate tree children per page. Breadcrumbs keep ancestors reachable; search and paging use ordinary GET URLs, so links and browser history work.
- Load only the editor explicitly selected by `edit`. Closed cards contain no parent dropdown, update form, or destructive form. Authorization and cycle/parent validation remain in the existing server actions.
- Keep direct and rolled-up occupancy calculated over the complete accessible hierarchy, not just the visible page. Owner/type summaries explicitly describe this page's cards.
- Keep the normal/deck-location distinction, active state, visibility, vault sections, advisory capacity, existing assignments, and owner boundaries unchanged.
- On phones, search gets a full-width field and the tree has a bounded scroll area. A top-level jump link reaches storage browsing without passing through setup controls.

This is bounded rendering over an owner-scoped metadata set, not database cursor pagination. Create/move selectors remain linear-size native controls, and an opened editor has one owner-scoped parent selector. The change removes quadratic repetition without introducing a second authorization/API path. No migration is required.

## Evidence

Local production Docker, same laptop and snapshot:

| Run | Synthetic locations | Physical copies / rows | Load to Locations heading | Serialized live DOM HTML | Option elements |
| --- | ---: | ---: | ---: | ---: | ---: |
| Released location page | 300 | 150,000 / 3,000 | 8,021 ms | 32,204,651 bytes | 93,951 |
| Bounded browser, first verification | 1,200 | 150,000 / 3,000 | 1,098 ms | 1,164,658 bytes | 3,615 |

The original page rendered 611 forms; the new page renders zero per-location editor forms until Manage is selected. These are individual development measurements, not production latency guarantees or a statistically controlled benchmark. The fixture uses one cached printing spread across 3,000 stacks to isolate location-page cost; it does not benchmark 150,000 unique printings or all inventory workflows. Default Unassigned is additional to the synthetic location count.

The opt-in browser test checks 1,200 locations, 100 parent vaults, 1,100 sub-locations, 150,000 copies, bounded DOM/card counts, search of a late-page descendant, page reset, opening/saving/closing one editor, phone width, branch breadcrumbs, and rejection of another owner's parent/edit IDs. It verifies quantity conservation and removes its uniquely identified owners, locations, inventory, user, and audit fixtures in `finally`.

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
npx.cmd playwright test tests/ui/location-scale.spec.ts tests/ui/location-hierarchy.spec.ts tests/ui/vault-pilot.spec.ts
```

The first targeted run passed all five tests, and desktop/phone screenshots were inspected. A subsequent phone refinement expands the search field and caps tree height; final full verification is recorded in the PR and `LOCAL_REVIEW_BUILD.md`.
