# UI acceptance status - 2026-09-23

Related: #262, #263, #264, #265, #268 and #274. This is the current implementation/evidence index; the original design prototype and historical feature notes are retained as dated records. No issue is closed by this document and no PR is merge-approved.

## Review stack and current build

Review #316 (import integrity), then #320 (Dashboard/Pricing/Public), #322 (League), and #324 (Administration). Each depends on its predecessor. Acquisition planning #315 is independent and implementation remains deferred. Main is `bfb7be8`; the cumulative application source is checkpoint `8776e77`, with validation corrections/docs through `9493d6c`.

Local review: http://127.0.0.1:13001. Healthy image `sha256:09053d1ce741b62d1372c7cc0bad41f52c6302d84fbc9e4c44cb9cd04b86ff70`. Production is unchanged. See LOCAL_REVIEW_BUILD.md for task instructions.

## Capability evidence index

The existing [capability crosswalk](design/ui-consolidation/CAPABILITIES.md) still covers all **34 current page routes**, verified against app/**/page.tsx on this revision. Its action IDs and scope differences remain the review checklist; route enumeration alone cannot prove action parity.

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

Full serial browser run was interrupted at the user-requested laptop shutdown after 29 passing cases. It is not a completed full-suite pass; rerun after resuming. Cleanup verified zero fixture users and 12,477 physical copies. Per-batch 582 units, typecheck, Linux production builds/manifest guards and focused workflow evidence already passed. Both CI jobs for #324 passed (run 35855847657), including the new PostgreSQL pricing checks.
