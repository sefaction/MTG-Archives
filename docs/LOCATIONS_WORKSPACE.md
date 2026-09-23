# Browse-first Locations

For current acceptance, review dependencies and reliability status, see [UI acceptance status](UI_ACCEPTANCE_STATUS.md). Historical follow-up statements below are superseded by that dated reconciliation and live GitHub.


Issue: #266. Built on the released Inventory shell (`eab4272`). No schema migration or storage placement rewrite.

## Capability homes

| Existing capability                                 | Home                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Full-path/type search, bounded results and paging   | Storage search and left-hand browse list, 25 results per page                                                                             |
| Hierarchy, breadcrumbs, roll-up counts              | Browse branches and selected location's Browse sub-locations action; direct and descendant counts stay distinct                           |
| Location counts, description, visibility            | Selected detail; one location at a time                                                                                                   |
| Vault Sect 0–5, advisory 85-copy capacity, overflow | Selected vault map, one left-to-right row with contained phone scrolling                                                                  |
| Arbitrary/unsectioned placements                    | Vault extras or ordinary-location Sections; exact/empty Inventory links                                                                   |
| Create, owner choice, parent, new/shared type       | Toolbar Create location; returns to the created location                                                                                  |
| Name, parent, type, description, visibility, active | Selected location Manage; editor loaded only for that location                                                                            |
| Whole-location move                                 | Selected location Move all cards; fixed source, same-owner active destinations, direct contents only, visibility warning and confirmation |
| Delete contents or unused location                  | Collapsed Danger zone inside Manage; existing server-side checks and typed/checkbox confirmations retained                                |
| Shared type usage/deletion/migration                | Toolbar Location types; creator/other-owner/admin restrictions retained                                                                   |
| System-managed deck storage                         | Separate searchable/paged Deck locations view, read-only with Open deck links                                                             |

## Navigation and scale

Browse state is URL-backed (`q`, `parent`, `page`, `treePage`, `selected`, `edit`, `panel`, `view`). Existing `edit` and branch links still work. Inventory section navigation uses the existing exact-section helper; browser Back returns to the URL-backed browse context. Explicit inaccessible selections show unavailable rather than silently selecting another item. All location inputs to browsing are still server-authorized.

Creation/type maintenance are rendered only when requested. Detail renders at most one vault map/editor. Parent and move destination pickers search full paths and render at most 30 matches, one retained selection, and an empty option. They use native listboxes and preserve selection while searching. Admin creation filters parents by the chosen owner; edit excludes self/descendants and system/default locations. Authoritative parent/move validation remains in the existing services.

The server still loads authorized hierarchy/count metadata for paths and roll-ups; this is bounded **rendering**, not database-level hierarchy pagination. Shared type usage is intentionally global metadata under the existing policy. No card data or new global cache is introduced.

## Verification

See WORK_CHECKPOINT.md and the PR for current results. Browser coverage includes a disposable create/edit/move/delete/deck/admin-boundary lifecycle; exact arbitrary/vault section links and Back; existing hierarchy and vault workflows; a bounded fixture with 1,200 locations, 3,000 stacks, 1,000 printings, 150,000 copies for one owner and 5,000/500/7 copies for three others; first-viewport checks, phones, theme reflow and enlarged text. This remains synthetic scale coverage, not a production load benchmark. Existing #220/#260/#280 remain independent unresolved observations, not fixes established by a passing run.

Source-review follow-up #283 records the inherited inactive-parent editing risk. This presentation batch does not change the existing inactive-parent domain policy or claim to resolve it. Active hierarchy creation/edit/move paths are covered; inactive subtree metadata editing needs the separate regression/fix.

This batch does not claim whole-app parity or complete accessibility certification. Data mutations in new tests are confined to UUID-owned local fixtures; real collection data and production remain untouched.
