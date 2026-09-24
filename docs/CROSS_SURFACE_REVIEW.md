# Cross-surface inventory review gate

Issue #334. When changing shared Inventory search, filters, results, details or navigation, record the affected surfaces in the PR and run the representative checks below. “Parity” means the same useful task pattern where the capability exists; it does not grant Public mutation or replace League's season rules.

| Surface | Representative behavior | Regression evidence |
| --- | --- | --- |
| Private owner/admin | Search and structured drafts, active chips, Back/Forward, grouped/exact browse, selection/move/detail, authorized controls | `tests/ui/inventory-workspace.spec.ts`, `inventory-detail`, `vault-map`, inventory policy units |
| Anonymous Public | Public-only rows, shared search/filter/results and no-result recovery, phone dialog/keyboard, no edit/move/delete | `tests/ui/public-inventory-parity.spec.ts`, `browse-pricing-workspaces.spec.ts`, `public-inventory-readonly.test.ts` |
| Signed-in Public | Same public scope; eligible viewer wishlist/deck actions without owner mutation | `tests/ui/public-inventory-parity.spec.ts`, `trade-wishlist.spec.ts`, `browse-pricing-workspaces.spec.ts` |
| League member/organizer | Season-linked location search, deck submission/frozen state, separate organizer controls and no authoritative inventory mutation from tools | `tests/ui/league-lifecycle.spec.ts`, Commander League policy units |

For every shared-component PR, state which of these paths changed, which tests and actual viewport sizes were run, and why any untested role is unaffected. Include a populated multi-owner case, filtered zero results, loading/error behavior, keyboard focus/Escape, 1366×768 and 390/320px when the change affects layout. Verify server authorization separately from hidden controls. Record intentional deviations in the [parity audit](PUBLIC_LEAGUE_PARITY_AUDIT.md) and [UI acceptance status](UI_ACCEPTANCE_STATUS.md).

The new Public browser fixture and existing League lifecycle fixture use local, disposable data. Their passing paths do not establish exhaustive four-user or all-theme accessibility coverage; #274 retains that broader acceptance gate.
