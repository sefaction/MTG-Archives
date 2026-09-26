# UI acceptance status - 2026-09-26

Related: #262, #263, #264, #265, #268 and #274. This is the implementation/evidence index; the original design prototype and historical feature notes are retained as dated records. This document does not close an issue or approve a PR merge.

## Enlarged Inventory layout check, 2026-09-26

The focused Inventory workspace browser fixture now renders a 683×384 CSS viewport at device pixel ratio 2, matching the layout area and pixel density of a 1366×768 window at 200% zoom. It checks no page-level horizontal overflow, visible results before opening Filters, a modal filter panel, reachable Close/Apply controls within the viewport, Escape returning focus to Filters, and the existing invalid-query path. The final 683×384 screenshot was inspected: the filter heading, tabs, query field and sticky actions remain visible; longer help text scrolls inside the panel. This is Chromium device-metrics emulation, not a manual browser-chrome zoom check. Real browser zoom and the broader human task review remain open under #274.

## Inventory-first local review, 2026-09-26

The user's task review identified that copy amounts should be chosen before Move. A follow-up review branch now selects a full stack by default and offers a copy spinner beside each selected row in the table and card views. Move carries those per-row amounts; all-matching bulk selection retains its separate aggregate limit. The local Docker image `sha256:fa73bb6ceac9c957fd2c4c50f826c3a78a7e649c972e64fd0d594409200845da` passed the vault creation, chosen-partial move, stale-selection rollback, occupancy and phone-layout browser case, plus typecheck and the focused storage planner tests. This branch still needs its own PR/CI and user review. The previously recorded wider acceptance gaps remain open.

An expanded fixture revealed that one visible Exact-printing row can represent multiple storage records. The follow-up revision sends each visible row's chosen total and source IDs together, validates the complete group, then allocates from movable source records in creation order. The cumulative Docker image `sha256:dfac076c44282613485cbb1495570c1fdb67a52914fcbf12b5fbbf6b4c2e80aa` passed the revised browser case with two simultaneous partial splits, stale-selection rollback, conserved copies, refreshed occupancy, the displayed-entry count and phone layout. The broader human review and 200% browser zoom gates remain open.

The user chose Inventory filtering and moves as the first combined local Docker review. The cumulative image `sha256:ee40dae9a3ebd9b8db77b79686e65e0287b0b12987462a5dc400e333ed001a6f` is healthy and contains approved #369, which compacts navigation at narrow desktop widths while retaining the Inventory workspace breakpoint. Its focused Inventory/navigation Playwright cases passed 2/2 at 960×455 CSS px; color filtering and the vault selection/move flow passed another 3/3. The move fixture covers partial quantities, section occupancy, selection and phone layout. Actual browser 200% zoom and the user's hands-on task observations remain open. See [LOCAL_REVIEW_BUILD.md](LOCAL_REVIEW_BUILD.md) for the task sequence. Historical build IDs below describe the September 23 acceptance pass and are retained for traceability.

## Follow-up touch check, 2026-09-23

A real touch-enabled Chromium context at 390 and 320 CSS px now signs in, taps the phone navigation to Inventory, opens and closes the modal filters, retains an unsaved query draft, and taps through navigation to Settings. The check asserts coarse-pointer emulation and no page-level overflow in Inventory and Settings. It uses an isolated owner fixture and cleans that fixture afterward. This covers a narrow touch path on the cumulative local Docker build, not real hardware, browser zoom, all themes, all roles, or the matched human task observations still required by #274. The test-only follow-up does not change the application image or close #274.

## Review stack and current build

Review #316 (import integrity), then #320 (Dashboard/Pricing/Public), #322 (League), #324 (Administration), and [#325 acceptance reconciliation](https://github.com/sefaction/MTG-Archives/pull/325). Each depends on its predecessor. Acquisition planning #315 is independent and implementation remains deferred. Main is `bfb7be8`; the cumulative application source is checkpoint `8776e77`, with validation corrections/docs through `9493d6c`.

Local review: http://127.0.0.1:13001. Healthy image `sha256:09053d1ce741b62d1372c7cc0bad41f52c6302d84fbc9e4c44cb9cd04b86ff70`. Production is unchanged. See LOCAL_REVIEW_BUILD.md for task instructions.

## Capability evidence index

The existing [capability crosswalk](design/ui-consolidation/CAPABILITIES.md) still covers all **34 current page routes** and **45 action IDs**, verified against `app/**/page.tsx` and the crosswalk rows on this revision. Its action IDs and scope differences remain the review checklist; route enumeration alone cannot prove action parity.

| Capability family | Retained home and current implementation record | Behavioral evidence on the cumulative build |
| --- | --- | --- |
| Inventory filters/results, details, selection, moves, maintenance, export | Inventory; INVENTORY_WORKSPACE.md; export remains in Imports | inventory-workspace, inventory-color-filter, inventory-scryfall-query, inventory-detail, inventory-export, vault-map, vault-pilot |
| Storage hierarchy, layouts, occupancy and management | Locations; LOCATIONS_WORKSPACE.md | locations-workspace, location-hierarchy, inactive-location-parent, storage-layout, location-scale |
| CSV/single-card capture, review, progress, export and guarded undo | Imports; IMPORTS_WORKSPACE.md; #316 | imports-workspace plus real PostgreSQL commit concurrency, rollback, retry/audit and undo checks |
| Deck library/builder, exact printing/commander/sections, commitment/return/import/optimization/settings/delete | Decks and builder; DECK_BUILDER_WORKSPACE.md, merged library work #295 | decks-brackets, deck-builder-workspace, pasted-decklist; unit/domain checks for optimization and permissions |
| Public/private deck tools | Shared Deck tools navigation and return context | deck-analysis, deck-sample-hands, existing deck-playtest/playtest-advanced regression only; no new Playtest work |
| Wishlist and trade lifecycle | Wishlist/Trades; merged #298 | trade-wishlist, trade-lifecycle; reservations/provenance/conservation assertions |
| Dashboard, Pricing and Public | Scoped Dashboard, Pricing task tabs, public navigation; BROWSE_PRICING_WORKSPACES.md; #320 | browse-pricing-workspaces; synthetic zero/missing/EUR prices and anonymous/private scope |
| Settings, authentication and notifications | Global Settings destination; password/email/webhook choices inside Settings; activity utility | settings-themes, navigation-layout, auth-sessions, login-return, notifications, email-settings, webhook-settings |
| Administration and recovery controls | Shared task navigation; ADMIN_WORKSPACES.md; #324 | admin-workspaces, admin-backups, admin-metadata, admin-notification-delivery; actual pricing PostgreSQL checks; no new destructive recovery drill |
| League member/organizer/frozen decks and statistics | Season standings/record/history/manage, library, scoped stats; LEAGUE_WORKSPACES.md; #322 | league-lifecycle preserves printings, immutable game snapshots and physical-copy conservation |

The filenames above are coverage pointers, not assertions that every possible control/role combination is exercised. Final combined-run results are recorded below. Required CI and individual user review are separate gates.

## Action-level verification boundary

The 45 action IDs in [CAPABILITIES.md](design/ui-consolidation/CAPABILITIES.md) name each retained control home and role boundary. The current cumulative application revision for this review is `8776e77`. The following checks run against that revision's Docker image; a browser case exercises a representative path within each ID, not necessarily every action named in that ID. Source-mapped controls remain in the crosswalk even where no direct browser mutation was repeated in this pass.

| Action IDs | Current direct evidence | Remaining limit |
| --- | --- | --- |
| I01-I03 | `inventory-workspace`, `inventory-color-filter`, `inventory-scryfall-query`, `location-hierarchy` | Not every filter combination is exhaustive |
| I04-I07 | `inventory-workspace`, `inventory-export`, `vault-pilot`, `vault-map` | All-matching and every view preference are not crossed with every role |
| I08-I11 | `inventory-detail`, `trade-wishlist`, inventory mutation/policy units | Destructive cleanup and every edit/split field are source mapped rather than browser repeated here |
| L01-L05 | `locations-workspace`, `location-hierarchy`, `location-scale`, `storage-layout`, `vault-map` | Every destructive storage action is not rerun on the snapshot |
| M01-M05 | `imports-workspace`, `inventory-export`, real PostgreSQL import integrity script | Every legacy unsafe undo branch is checked in database tests, not through a browser path |
| D01-D05 | `decks-brackets`, `deck-builder-workspace`, `pasted-decklist`, `league-lifecycle` | Every optimization and folder variant is not repeated in browser |
| D06-D09 | `deck-analysis`, `deck-sample-hands`, existing `deck-playtest`/`playtest-advanced` regressions | No new Playtest behavior or changes in this goal |
| W01, T01-T03 | `trade-wishlist`, `trade-lifecycle` | Representative partner and owner flows; no exhaustive four-user trade permutations |
| U01-U04 | `settings-themes`, `email-settings`, `webhook-settings`, `notifications`, `auth-sessions`, `login-return` | Delivery uses local capture and policy guards; no external messages |
| P01 | `browse-pricing-workspaces` plus pricing units | No production-scale market query benchmark |
| A01-A03 | `admin-workspaces`, `admin-backups`, `admin-metadata`, `admin-notification-delivery`, prior isolated recovery drill | No destructive restore in this acceptance pass |
| G01-G03 | `league-lifecycle` plus League statistics units | Synthetic populated season; no broader user study |

All page routes remain in the crosswalk and every action ID has a named home. This table distinguishes direct checks from capability completeness; the open issues still require user review and the broader manual gates below.

## Issue-by-issue reconciliation

| Issue | Implemented/evidenced | Remaining acceptance |
| --- | --- | --- |
| #263 Foundation | Original two-option prototype/crosswalk, later user-selectable navigation, grouped Settings, current-route and phone menu; Inventory/Locations first-fold and keyboard fixtures | User review of the final cumulative navigation; systematic all-theme contrast audit remains part of #274 |
| #264 Inventory filters | Shared drafts, task tabs, bounded phone dialog, chips/Back/Forward/deep links and invalid-expression feedback have browser coverage | Final combined evidence and user acceptance; no claim that all failure/network states have been manually observed |
| #265 Selection/moves/vault | Contextual copy/row counts, exact sections, fill/advisory overflow, reservations/provenance and source/destination refresh have fixtures | Final user review of the populated move workflow; broad touch/focus/zoom matrix remains under #274 |
| #268 Decks | Builder dialogs/cards-first layout, library organization and shared tool navigation shipped in prior approved batches; current regression covers editable/public/frozen contexts | User review of combined Decks behavior; no further Playtest changes authorized |
| #274 Acceptance | Route/action index, owned fixtures, responsive/keyboard checks, realistic varied-printing storage scale and cumulative browser gate | Matched human task observations; comprehensive contrast, real browser 200% zoom, touch and full keyboard journeys across all roles/themes; individual PR review |
| #262 Umbrella | Implementation across workspace batches is available for review | Depends on outstanding acceptance and individually approved merges; remains open |

Resolved reliability references in older feature notes are historical: #220, #260 and #280 are closed on GitHub after prior approved fixes/audits. This reconciliation does not recreate those defects or imply that a fresh passing rerun alone established their fixes.

## Measurement boundaries

- Existing fixtures assert the actual 1366x768/1440x900 desktop and 390/320px phone layouts for core Inventory/Locations/Deck workflows. Expanded League/Admin coverage adds task-specific desktop/phone checks. Locally scrolling tables/maps are intentional; page-wide overflow is not.
- Scale fixture: 1,200 locations, 3,000 stacks across 1,000 cached printings, 150,000 physical copies for one owner and 5,000/500/7 for three others. This proves that synthetic scenario, not production concurrency or every inventory query at that scale.
- Keyboard fixtures cover navigation, bounded dialogs, focus trapping/Escape/return and control labels. Six-theme reflow and 200% root text-size tests do not equal a complete contrast audit, browser-zoom test or WCAG certification.
- Existing builder baseline moved card-content start from y=629 to y=350 on a matched deck. The original design prototype coordinates and prior different-width Inventory observations are not matched production speed benchmarks. No new click/time savings are invented.
- Administration live observations: pre-change history scan 31,686ms; post-change health 632ms and concurrent dashboard 115ms during exact totals calculation. Exact totals remain potentially slow, explicitly on demand, bounded and cached.

## Combined validation

A clean serial **51/51 browser cases passed in 7.8 minutes** against cumulative application image `sha256:09053d1ce741b62d1372c7cc0bad41f52c6302d84fbc9e4c44cb9cd04b86ff70`. The first full attempt had 50 pass / 1 timeout: its Admin password-reset test still navigated to `/admin` after the action moved to `/admin?view=users`. The test now follows Users; the focused security lifecycle passed before the clean 51/51 rerun. No security implementation or test timeout was changed. Final fixture cleanup verified zero `ui-*` users and 12,477 physical copies.

The varied-printing storage case measured 1,200 nodes, 1,000 printings, 150,000 copies across four uneven owners; this local run loaded Locations in 2,924ms and rendered 81,727 HTML bytes / 12 options. Administration health loaded in 1,036ms and a concurrent dashboard request in 146ms during exact history totals. These are local fixture observations, not production performance guarantees.

Per-batch 582 units, typecheck, Linux production builds/manifest guards and focused workflow evidence already passed. Both CI jobs for #324 passed (run 35855847657), including the new PostgreSQL pricing checks. The acceptance branch changes only one browser navigation test and documentation; the app image and local database schema are unchanged.
