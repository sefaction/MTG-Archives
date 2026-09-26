# UI action verification ledger

This is the current companion to the historical [capability crosswalk](design/ui-consolidation/CAPABILITIES.md). Each ID has a retained home and one representative automated check. The last checked application code is `cfdd0c2`: the 70-pass local Chromium run used image `sha256:a016a0e1ab3947d47d6b1f29bf20447ac842363c1a41eeb140f6a555c660dc7f`, and the intervening merges through `cfdd0c2` changed tests and documentation only. PR #434's focused export case passed on that image. One full-size Pricing retention load case was intentionally excluded from the 70-pass run and has separate #330 evidence. A representative check does not certify every action variant, role or assistive technology.

| ID | Retained home | Representative check | Last app revision | Remaining coverage limit |
| --- | --- | --- | --- | --- |
| I01 | Inventory search and filters | `tests/ui/inventory-workspace.spec.ts` | `cfdd0c2` | Filter combinations are sampled. |
| I02 | Inventory collection filters | `tests/ui/location-hierarchy.spec.ts` | `cfdd0c2` | Owner and section combinations are sampled. |
| I03 | Inventory advanced query | `tests/ui/inventory-scryfall-query.spec.ts` | `cfdd0c2` | Unsupported expressions remain an explicit local error path. |
| I04 | Inventory view options | `tests/ui/inventory-workspace.spec.ts` | `cfdd0c2` | Preferences are not crossed with every owner or display mode. |
| I05 | Inventory row and all-matching selection | `tests/ui/inventory-allmatching-export.spec.ts` | `cfdd0c2` | Cross-page filtered selection is checked for export; bulk move has separate evidence. |
| I06 | Inventory and vault Move | `tests/ui/vault-pilot.spec.ts` | `cfdd0c2` | One partial, fill and stale-selection path; not every reservation race. |
| I07 | Inventory selection export and Imports Export | `tests/ui/inventory-allmatching-export.spec.ts` | `cfdd0c2` | Filtered all-matching MTG Archives CSV and selected Moxfield have separate checks; formats are not fully crossed. |
| I08 | Inventory danger actions | `tests/ui/inventory-mutation-acceptance.spec.ts` | `cfdd0c2` | Confirmed row deletion checked; bulk and zero-quantity cleanup are not repeated in browser. |
| I09 | Inventory card detail | `tests/ui/inventory-detail.spec.ts` | `cfdd0c2` | Representative owned and public printings, not every card face. |
| I10 | Inventory edit and split | `tests/ui/inventory-mutation-acceptance.spec.ts` | `cfdd0c2` | Notes and quantity split checked; all fields and restricted stacks are not crossed. |
| I11 | Inventory audit and linked actions | `tests/ui/inventory-detail.spec.ts` | `cfdd0c2` | Audit focus/read path checked; Add to deck and public wishlist have separate checks. |
| L01 | Locations create and Manage | `tests/ui/locations-workspace.spec.ts` | `cfdd0c2` | Owner/reparent restrictions also rely on policy tests. |
| L02 | Locations browser and search | `tests/ui/location-scale.spec.ts` | `cfdd0c2` | One 2,200-node synthetic hierarchy. |
| L03 | Vault section map and occupancy | `tests/ui/vault-map.spec.ts` | `cfdd0c2` | One selected vault, not every overflow pattern. |
| L04 | Locations type and deletion controls | `tests/ui/locations-workspace.spec.ts` | `cfdd0c2` | Type deletion and deck-location constraints are not all repeated in browser. |
| L05 | Locations content move, delete and export | `tests/ui/location-contents-delete.spec.ts` | `cfdd0c2` | Direct-contents deletion checked; whole-location variants have separate tests. |
| M01 | Imports Add card | `tests/ui/imports-workspace.spec.ts` | `cfdd0c2` | Search and task home checked; attribute permutations are not exhaustive. |
| M02 | Imports CSV capture and Review | `tests/ui/imports-workspace.spec.ts` | `cfdd0c2` | Two-row commit and 120-row review sample. |
| M03 | Imports resolution progress | `tests/ui/imports-workspace.spec.ts` | `cfdd0c2` | Resolver return/edit checked; cancel/retry permutations rely on domain tests. |
| M04 | Imports commit, history and undo | `tests/ui/imports-workspace.spec.ts` | `cfdd0c2` | Tracked undo checked; unsafe legacy partial undo relies on database tests. |
| M05 | Imports Export | `tests/ui/inventory-export.spec.ts` | `cfdd0c2` | Whole collection and one normal location sampled. |
| D01 | Deck library and organization | `tests/ui/decks-brackets.spec.ts` | `cfdd0c2` | Folders/tags and every view combination rely on other tests. |
| D02 | Deck Builder | `tests/ui/deck-builder-workspace.spec.ts` | `cfdd0c2` | Populated edit path; every metadata/card section variant is not crossed. |
| D03 | Deck physical commitment and return | `tests/ui/deck-builder-workspace.spec.ts` | `cfdd0c2` | Selected/all return checked; commitment authority has domain tests. |
| D04 | Deck selection and printing tools | `tests/ui/deck-builder-workspace.spec.ts` | `cfdd0c2` | Tool access checked; optimize and bulk mutation variants rely on domain tests. |
| D05 | Deck import and export | `tests/ui/pasted-decklist.spec.ts` | `cfdd0c2` | Pasted import checked; formats and copy variants are sampled. |
| D06 | Deck Analysis | `tests/ui/deck-analysis.spec.ts` | `cfdd0c2` | Read-only snapshot and chart selection sample. |
| D07 | Deck Sample hands | `tests/ui/deck-sample-hands.spec.ts` | `cfdd0c2` | Seeded London mulligan sample. |
| D08 | Deck Playtest | `tests/ui/deck-playtest.spec.ts` | `cfdd0c2` | Manual sandbox path; no rules engine claim. |
| D09 | Deck Playtest session files | `tests/ui/playtest-advanced.spec.ts` | `cfdd0c2` | Device-local persistence sample, not every mismatch import. |
| W01 | Wishlist | `tests/ui/trade-wishlist.spec.ts` | `cfdd0c2` | Manual-add entry and separation checked; every need edit is not repeated in browser. |
| T01 | Trades wishlist bridge | `tests/ui/trade-wishlist.spec.ts` | `cfdd0c2` | Representative partner browse and quantity controls. |
| T02 | Trades proposal and counter | `tests/ui/trade-lifecycle.spec.ts` | `cfdd0c2` | Two-party exchange and phone proposal sample, not all partner permutations. |
| T03 | Trades physical confirmation and history | `tests/ui/trade-lifecycle.spec.ts` | `cfdd0c2` | Copy conservation and single completion checked for one exchange. |
| U01 | Settings preferences | `tests/ui/settings-themes.spec.ts` | `cfdd0c2` | Theme save sample; other preference forms have domain tests. |
| U02 | Settings delivery channels | `tests/ui/email-settings.spec.ts` | `cfdd0c2` | Email sample; webhook has its own browser test; no external delivery. |
| U03 | Notifications | `tests/ui/notifications.spec.ts` | `cfdd0c2` | In-app center sample; digest/replay have separate checks. |
| U04 | Account, login and Admin Mode | `tests/ui/auth-sessions.spec.ts` | `cfdd0c2` | Session lifecycle sample; return-path and route guards have separate checks. |
| P01 | Pricing workspace and card history | `tests/ui/browse-pricing-workspaces.spec.ts` | `cfdd0c2` | Local pricing/provider sample; no production load claim. |
| A01 | Administration users | `tests/ui/admin-workspaces.spec.ts` | `cfdd0c2` | User/admin route sample; bootstrap and revocation have separate checks. |
| A02 | Administration Recovery | `tests/ui/admin-backups.spec.ts` | `cfdd0c2` | Route/control access only; isolated restore evidence is separate from this browser run. |
| A03 | Administration maintenance | `tests/ui/admin-metadata.spec.ts` | `cfdd0c2` | Metadata controls sample; Pricing/delivery tools have separate checks. |
| G01 | League season and standings | `tests/ui/league-lifecycle.spec.ts` | `cfdd0c2` | One populated synthetic season. |
| G02 | League submitted decks and games | `tests/ui/league-lifecycle.spec.ts` | `cfdd0c2` | Member/frozen and recorded-game sample. |
| G03 | League statistics | `tests/ui/league-lifecycle.spec.ts` | `cfdd0c2` | Synthetic snapshot analytics; broader season distributions are not sampled. |

The original crosswalk remains the source for complete capability wording and role boundaries. This ledger records one current check per ID, with its practical limit. The task-observation/action-count gate and broader keyboard/assistive-technology review remain under #274.
