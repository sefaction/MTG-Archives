# Capability crosswalk

Current implementation and verification status: [UI acceptance status](../../UI_ACCEPTANCE_STATUS.md). The design baseline below is historical; its pending/open labels describe that original review, not current GitHub status.


Source-inspected at main `7a32dd3` on 2026-09-21. Proposed homes are a design contract, not implemented routing or verified parity. All existing URLs are retained, including query strings/anchors and shared deck tools. No blank home is allowed. The table covers every `app/**/page.tsx`; the companion QA script checks this route inventory. Grouped action rows below preserve rare capabilities that a route list alone would miss.

Evidence abbreviations: **I** = InventoryBrowser, InventoryAdvancedSearch and inventory page/actions; **L** = locations page, StorageDestinationPicker, VaultSectionMap; **D** = deck pages/actions, DeckWorkspace, DeckActionPanels, DeckListEditor and DeckToolsNav; **M** = imports page/actions and import/export components. Test filenames below are historical coverage pointers, not claims of fresh production verification. Shared baseline for every row is `7a32dd3`; new implementation evidence is **pending** for every row.

## Route homes and access

| Existing page route | Proposed home | Scope / differences to retain | Evidence / future check |
| --- | --- | --- | --- |
| `/` | Brand / landing | Signed-in versus anonymous entry | app/page.tsx; entry smoke |
| `/dashboard` | Overview | Current-user dashboard; League entry | app/dashboard/page.tsx; launch links |
| `/inventory` | Collection / Inventory | Owner scope; deliberate admin mode; capability-gated actions | I; inventory-detail, inventory-color-filter, inventory-scryfall-query |
| `/locations` | Collection / Locations | Owner tree; authorized owner controls; system/deck location limits | L; location-hierarchy, location-scale, vault-map |
| `/imports` | Collection / Add / Import / Export | Own capture/review/history; restricted maintenance and undo | M; inventory-export and import units |
| `/decks` | Decks / library | Private-owner workspace, public differences, folders/tags/brackets | D; decks-brackets |
| `/decks/[deckId]` | Decks / builder | Owner mutation versus visibility-safe read; League policy/frozen state | D; deck policy tests, league-lifecycle |
| `/decks/[deckId]/import` | Deck builder / Add or import | Authorized deck mutation; explicit review and printing/commander choices | D; pasted-decklist |
| `/decks/[deckId]/analysis` | Deck tools / Analysis | Visibility-safe snapshots; no inventory mutation | ManaCurveAnalysis/ManaProductionAnalysis; deck-analysis |
| `/decks/[deckId]/hands` | Deck tools / Sample hands | Visibility-safe, local simulation | SampleHands; deck-sample-hands |
| `/decks/[deckId]/playtest` | Deck tools / Playtest | Device-local/non-authoritative; bounded saves and imports | PlaytestSandbox/AdvancedControls; deck-playtest, playtest-advanced |
| `/wishlist` | Wishlist | Manual versus derived deck needs; owned printing and quantity semantics | wishlist page/actions, WishlistTable; trade-wishlist |
| `/trades` | Trades | Partner overview, active/history; own actions and receipt | trades page/actions, TradeBuilder; trade-lifecycle |
| `/pricing` | Pricing | Current scope, provider/currency, market/data distinctions | pricing page; pricing units, manual chart/status check |
| `/pricing/card/[cardId]` | Pricing / owned card history | Signed-in owner of this exact card printing, or active admin scope; provider/currency/range context retained | card history page; pricing-owned-movers, pricing-card-history |
| `/pricing/digest/[observedDate]` | Pricing / dated digest | Signed-in recipient only; validated UTC date and owned notification payload | digest page; pricing-digest |
| `/public` | Public browsing / home | Anonymous/public visibility; signed-in navigation differences | PublicNav; public browse smoke |
| `/public/inventory` | Public browsing / inventory | No owner/admin edits; eligible signed-in other-owner trade-wishlist action remains | public inventory page/actions, I; trade-wishlist, inventory-detail |
| `/public/decks` | Public browsing / decks | Read-only library, folders/tags/views; authorized shared deck tools | DeckWorkspace; public/private deck checks |
| `/settings` | Account & settings / profile & preferences | Own identity/appearance/pricing/sharing/categories; explicit save | settings page; settings-themes |
| `/settings/email` | Account & settings / Notifications / Email | Own address/preferences/test/history; global SMTP availability | email page; email-settings |
| `/settings/webhooks` | Account & settings / Notifications / Webhooks | Own masked destinations; private-network choice restricted | webhook page; webhook-settings |
| `/settings/pricing-alerts` | Account & settings / Pricing alerts | Signed-in user's opt-in and thresholds; owner link required before enabling | pricing alerts page; pricing-digest |
| `/notifications` | Notifications / activity | Own unread/history/deep links | NotificationBell, notifications actions; notifications |
| `/change-password` | Account & settings / Security | Current user, required-password-change behavior, session invalidation | change-password page; auth-sessions |
| `/login` | Authentication / sign in | Safe return path, failed-login retry context | login page, auth helpers; login-return |
| `/admin` | Administration / Users & overview | Authorized admin and deliberate mode; current privilege rules | admin page, Nav; auth-sessions |
| `/admin/backups` | Administration / Recovery | Exact-name restore/delete gates; upload/download authorization | backups page/routes; admin-backups, isolated recovery drill |
| `/admin/metadata` | Administration / Card data | Privileged refresh and Commander bracket tools | metadata page/panels; admin-metadata |
| `/admin/prices` | Administration / Pricing worker | Worker heartbeat/jobs/runs/errors/logs and queue actions | prices page; pricing source/unit tests |
| `/admin/notifications` | Administration / Delivery | Diagnostics, job attempts/retry; protected destinations | notifications page; admin-notification-delivery |
| `/admin/notifications/trade-announcements` | Administration / Trade announcements | Global endpoints distinct from personal subscriptions | trade-announcements page; delivery policy checks |
| `/league` | Commander League / leagues | Current membership and privileged season creation | LeagueNav, league page; league-lifecycle |
| `/league/[leagueId]` | League / standings, rounds, games; separate setup | Membership/organizer checks, immutable snapshots | league page/actions; league-lifecycle |
| `/league/[leagueId]/decks` | League / submitted decks | Member submissions; always public, linked printing scope, frozen after match | league decks page/actions; league-lifecycle |
| `/league/[leagueId]/decks/[deckId]` | Compatible redirect into shared builder | Preserve League context and authorization | redirect page; League lifecycle + deep-link check |
| `/league/[leagueId]/stats` | League / statistics | Member scope, snapshot analytics, basic-land exclusions | stats page; League analytics units |

## Actions, secondary controls and invariants

| ID | Current capability / source | Proposed control home | Role / state boundaries | Evidence gate |
| --- | --- | --- | --- | --- |
| I01 | Name search; card/type/set/rarity/finish; color and color-ID modes; mana comparison/range | Search row + ordinary filter panel | Existing local evaluation; no query-time remote dependency | Inventory filter/expression units + browser cases |
| I02 | Location/type/section (substring/exact/empty), source, visibility, owner, availability | Filter panel, role-appropriate fields; removable active chips | Owner filter never grants wider scope; exact Sect 1 excludes Sect 10 | hierarchy + query parity + public scope |
| I03 | Scryfall expression and syntax/help | Explicit advanced disclosure in filters | Preserve local supported/unsupported behavior | inventory-scryfall-query + evaluator units |
| I04 | Table/binder, card size, exact/grouped, columns, sorting, page size, infinite/paginated | View options adjacent to results; sorting on table | Grouped bulk restrictions; persisted preferences and page context | Current I source; implementation view-state matrix |
| I05 | Ctrl/Shift selection, checkboxes, all-matching, clear, cross-page quantities | Row controls + contextual selection bar | Loaded range only; entries versus physical copies; hidden selection disclosed | vault-pilot + selection units |
| I06 | Bulk/partial/per-stack move, fill capacity, full destination hierarchy | Shared move review invoked by selection/row/vault shortcut | Preserve reservations, transactions, provenance, exact attributes, same-section arithmetic | vault-pilot, vault-map, move/concurrency fixtures; #260 |
| I07 | Selected/all-matching CSV exports in both formats | Selection More actions / Export | Current owner visibility; selection mode and filter criteria explicit | inventory-export + export units |
| I08 | Bulk/per-item delete; zero-quantity cleanup | Named danger group / maintenance | Existing privilege/capability checks and confirmation retained | inventory actions source; owned mutation fixtures |
| I09 | Printing, all faces/meld/related cards, mechanics, legalities, prices, location breakdown | Card detail | Public visibility and role-based actions; meaningful image/keyboard labels | inventory-detail four cases + image/related-card units |
| I10 | Edit printing, qty, finish, condition, language, notes, owner/location/section; split | Detail / per-stack actions | Current capability guards; no flattening lots; system/deck restrictions | inventory page onSaveEdit/onSplitInventoryStack + mutation checks |
| I11 | Inventory audit trail, Add to deck, eligible public trade-wishlist add | Detail / named actions | No private mutations on public surface; trade-wishlist addition is retained | InventoryAuditTrail/CardDetail; trade-wishlist + policy tests |
| L01 | Create, rename/edit, reparent, type, visibility, owner when authorized | Create button / selected-location actions | Cycles/cross-owner/system-managed restrictions | locations actions; location-hierarchy |
| L02 | Hierarchical browsing, search, pagination, edit context and breadcrumbs | Storage browser / selected location | Scales to thousands of nodes; no giant unsearchable picker | location-scale, hierarchy |
| L03 | Six sections, occupancy, free capacity, overflow; arbitrary/unsectioned labels | Selected vault detail / scoped Inventory map | Physical copies; direct location, not descendants or filtered-result totals | vault-map; #260 remains open |
| L04 | Location types and deletion, deck locations | Named storage-management destination | Deck-owned placement restrictions; type deletion rules | locations page type actions + policy fixtures |
| L05 | Move all location contents, delete contents/location, location export | Selected-location actions; separate danger group | Current reservation/provenance/confirmation safeguards | LocationMoveForm/ContentsDeleteForm; move/export tests |
| M01 | Manual add, exact printing choice, attributes, location/section | Capture / Add one card | Scoped owner; shared searchable destination picker | SingleCardInventoryAdd + addSingleCardToInventory |
| M02 | Upload/paste CSV, sample download, preview, row edits and printing search | Capture → active Review | Explicit commit; row versus copy counts; no silent printing guesses | imports page preview/update/resolve + import units |
| M03 | Persistent resolution job/progress, start/cancel/retry, skip/unskip | Active review controls | Preserve idempotency and recoverable jobs | ImportProgressPanel; import job tests |
| M04 | Confirm import once, history, undo, delete history, preview/failed purge, batch maintenance | Review primary action; History with separated maintenance | Undo/cleanup restrictions; provenance and reservations | imports actions confirm/undo/delete/purge + acceptance fixture |
| M05 | Whole-collection/location CSV export, exact Moxfield format | Export tab | Deck-managed locations keep deck export flow | InventoryExportForm, inventory-export |
| D01 | Deck create/edit/delete, folders create/rename/move/delete, deck-folder moves, tags, brackets, public/private, search/sort/table/visual views | Library + contextual editor | Owner/public/League distinctions; tag catalog and folder hierarchy | DeckWorkspace/actions, decks-brackets |
| D02 | Builder metadata/banner/commander, list/group views, add/edit/remove card, quantities/sections | Compact builder header + card workspace | Current deck authority and locked League denial | deck pages/ListEditor/actions + policy tests |
| D03 | Real copy creation/commit, per-card/bulk commit, return individual/all commitments | Availability/commitment controls near card selection | Exact lots, reservations, provenance; never League commitments | deck commitment tests + lifecycle fixtures |
| D04 | Change printing, optimize preview/apply, bulk move/remove | Contextual card/selection actions | Preview remains explicit; League linked-printing scope | deck API route tests + League fixture |
| D05 | CSV/pasted deck import, section/commander/printing review, export and copy workflows | Builder Add / Import; named export action | No Moxfield scraping; plain text limitations explicit | DeckImportPanel, pasted-decklist |
| D06 | Curve/type/card selection and mana demand/production analysis | Analysis tools | Read-only visibility-safe snapshot | deck-analysis |
| D07 | Seeded sample hands, shuffle, London mulligan/bottom selection | Sample hands | No physical inventory or deck mutation | deck-sample-hands |
| D08 | Manual playtest zones/actions/undo, counters/P-T/tap, tokens/copies, positions/groups, annotations, library/random/player/damage controls | Playtest workspace / contextual tools | Manual sandbox; 1,000 cards/1 MB/100 undo; no rules engine/multiplayer | deck-playtest, playtest-advanced + units |
| D09 | Device-local playtest saves/import/export and deck-version mismatch handling | Playtest session actions | Never silently overwrite mismatched state or mutate authoritative deck | playtest advanced acceptance |
| W01 | Manual need add/edit/remove, derived needs, Need/Ready/Get, printing/owned/cheapest changes | Wishlist list and row detail | Manual versus deck-derived authority, quantities and availability | wishlist actions/Table + trade-wishlist |
| T01 | Global partner-grouped wishlist; quantity update/cancel; interactive pairing | Trades overview / Wishlist bridge | Own wishlist and eligible public cards | trades page/actions + trade-wishlist |
| T02 | Quantity-aware multi-card builder, search, values, propose/counter/accept/decline/cancel | Partner workspace / paired review | Reservations, source-proposal release, no duplicate active acceptance | TradeBuilder/actions; trade-lifecycle |
| T03 | Two-party physical confirmation, transfer, wishlist reconciliation, history/timeline | Active trade detail / History | Provenance retained, conservation and single completed record | trade-lifecycle |
| U01 | Identity/color/theme, preferred pricing/provider/currency, visibility defaults and notifications | Account & settings section navigation | Explicit save scopes and success/error messages | settings page, settings-themes |
| U02 | Email address/categories/test/history; webhook create/edit/delete/test/categories/history | Account & settings / delivery channels | Masked credentials, endpoint policy; SMTP dependencies; local capture-only | email-settings, webhook-settings |
| U03 | Notification bell/title count, mark one/all read, open deep link/history | Utilities / Notifications | Per-recipient state, quiet behavior, no desktop push | notifications browser + units |
| U04 | Login/logout/password change, required reset, admin mode entry/exit | Utilities / Security and labelled admin entry | Server sessions, safe return paths and current privilege requirements | auth-sessions, login-return |
| P01 | Market/collection value/trends/movers/data status; card price histories | Pricing workspace + card detail | Scope/provider/currency and data freshness; no worker dependency for browsing | pricing source/unit checks + live visual review pending |
| A01 | Users create/edit/disable/reset and owner linkage, admin overview | Administration / Users | Current role guards, session invalidation, create-only bootstrap | admin page/auth-sessions + bootstrap fixture |
| A02 | Backup create/list/upload/download/restore/delete, storage status | Administration / Recovery | Exact filename/danger gates; secrets/pricing DB recovery boundaries | admin-backups + isolated recovery evidence |
| A03 | Card metadata and bracket refresh; price refresh/mapping/worker logs; notification diagnostics/retry/global endpoints | Administration subsections | Privileged, isolated destructive controls, bounded diagnostics | admin-metadata, admin-notification-delivery + units |
| G01 | Yearly league creation; members, linked locations, rounds, points and standings | League / play-day home; Setup secondary | Organizer versus member; yearly/monthly structure | league actions/page; league-lifecycle |
| G02 | Submitted deck create/import/edit, recording win/draw/elimination order, history | League / Decks and Games | Linked inventory printing scope, frozen decks, immutable match snapshots | league-lifecycle |
| G03 | Card/commander usage, color identity, monthly trends, composition, win rates, signature cards and sets | League / Stats | Snapshot-based; basic lands excluded only from card/set-centric stats | stats source/units; deep visual review pending |

## Non-page endpoints

The existing `app/api/**/route.ts` URLs remain unchanged. They back the mapped import progress/sample, inventory list/filter/audit/export, public list, card search, deck mutations/import resolution, pricing history, notification summary and privileged refresh/recovery workflows. Navigation consolidation is not permission to weaken server guards or replace those contracts. Endpoint-by-endpoint regression evidence is required when an implementation batch touches a consumer, not supplied by this route crosswalk.

## Coverage limits

The source map groups controls by task rather than pretending every button was exercised. It is complete for current page-route enumeration, but is still a review draft for action/role parity. Each implementation PR must expand the affected action IDs into concrete before/after checks. Prototype notes that mention future homes do not count as functional parity. Open issues #220/#260/#275 are not closed here.
