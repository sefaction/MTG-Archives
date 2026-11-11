# Site navigation proposal

Inventory becomes the starting point for managing your collection. The main menu has seven destinations for signed-in members, down from thirteen. The pages still use their existing addresses, so a saved Collector link or an open scan batch can take someone straight to the right place. The labels and order below are proposed for [#1019](https://github.com/sefaction/MTG-Archives/issues/1019).

## Main menu and section tabs

| Main destination | Landing page and related tasks |
| --- | --- |
| Dashboard | Current dashboard and its shortcuts. Rename its Import shortcut to **Add & export**. The app name also returns here for signed-in members. |
| Inventory | **Cards** opens the existing Inventory workspace. **Locations**, **Collector**, **Add & export**, **Pricing**, and **Card Hunt** are links in the Inventory section. |
| Decks | Deck library. A selected deck retains Builder, Analysis, Sample Hands, Playtest, and its Card Hunt shortcut. |
| Wishlist | Keep one direct entry for needs from decks, other members' collections, and Collector. The reason views and Combined view belong inside Wishlist. |
| Trades | Keep the trade workspace one step away from Public inventory and Wishlist. Proposals, active trades, and receipts stay in Trades. |
| Public | Opens Public inventory as today. The Public section retains Public home, Public inventory, and Public decks, with its own signed-out navigation. |
| Commander League | Keep a direct entry for leagues, with standings, rounds, submitted decks, and statistics inside each league. Its pool and deck rules stay visible in that context. |

Wishlist serves several workflows, so its global entry gives each of them the same destination. Trades handles the next step of exchanging cards with another member. Public browsing and Commander League keep separate entry points because they carry different access and collection rules.

Put **Settings** in the account controls and point the Account link at `/settings`. Password, email, webhooks, and pricing alerts remain available inside Settings. Keep Notifications in the bell and show Admin in the account area only in active Admin Mode. Signed-out navigation offers public browsing and login. The existing public deck and safe post-login return paths still work when visited directly.

## Inventory workflows

| Task | Current entry | Proposed entry |
| --- | --- | --- |
| Browse cards or manage a storage location | Separate Inventory and Locations links | Inventory → Cards or Locations. Keep existing location shortcuts from cards and storage filters. |
| Check set completion | Collector → set progress in the directory | Inventory → Collector → set progress and the set details from #1017. Keep the set selected when returning from a missing-card action where the Wishlist flow supports it. |
| Scan, photograph, upload, or review a batch | Import → Scan cards, Camera, Upload photos, or Batches | Inventory → Add & export → the same named input or Scan batches. Put a visible **Add cards** shortcut on Cards that opens Add & export. |
| Add a card by hand, import or export CSV, or find a prior import | Import → Add single card, New CSV import, Export Inventory, or Import History | Inventory → Add & export with visible links for **Add single card**, **Import CSV**, **Export inventory**, and **CSV import history**. |
| Check collection value or market prices | Pricing → Collection, Market, or Data | Inventory → Pricing. Keep the three Pricing views and the card-history and digest entry points. |
| Pull cards for a deck | Open Card Hunt or use the selected deck's Card Hunt link | Decks → eligible owned deck → Card Hunt with that deck selected. Return to the same deck and originating view. |
| Find cards from a pasted list | Card Hunt → pasted list | Inventory → Card Hunt. Retain deck selection as an option on the same page. |
| Find available copies of one card | Filter Inventory or paste a one-card list with a quantity into Card Hunt | **Find available copies** in private card details opens the same hunt planner in card context. Back returns to the prior filters and card. |

The **Add & export** landing should show capture, manual add, CSV import, export, and history without requiring users to open a disclosure. Use **Scan batches** for scan review and Trash, and **CSV import history** for CSV review and undo. Keep Correction photos inside the scan workflow and keep the guided scanner setup that already lives on Scan cards. Opening a view or returning to a batch must preserve the existing setup, review, and confirmation steps.

A card-context hunt needs an explicit scope. From grouped details, use the card identity across eligible printings. From exact-printing details, use that printing and any finish the user selected. Show the scope in the planner. Use the same current-owner, available-storage rules as the deck and list hunts, including the exclusions for active trade reservations and deck-committed copies. This entry requires a supported card-identity input to the existing planner and can follow the initial navigation change.

## Existing links and access

- Keep `/inventory`, `/locations`, `/collector`, `/pricing`, `/card-hunt`, and `/imports` as the existing pages under the Inventory section. Their descendant pages map to the same section. A hunt with a valid, owned deck selected can show Decks as the parent when opened from deck context.
- Keep `/card-hunt?deckId=…`, `/imports?view=history#import-history`, CSV review by `batchId`, scan review by `batch`, capture by `input`, and `/imports/batches` search and status links. Preserve queries, fragments, and Back/Forward behavior. Keep the return target local and authorized. For a direct hunt bookmark with a valid owned deck, offer a return to that deck's builder.
- Use normal links for page navigation and mark the actual page separately from its parent section. On phones, close the global menu after navigation and keep section links visible near the page heading. Preserve both saved desktop layouts, skip navigation, and keyboard focus behavior.
- Keep Collector's set details and missing-card actions with [#1017](https://github.com/sefaction/MTG-Archives/issues/1017), Wishlist's reason views with [#1018](https://github.com/sefaction/MTG-Archives/issues/1018), scanner setup with [#1016](https://github.com/sefaction/MTG-Archives/issues/1016), and personalized public links and sharing rules with [#1021](https://github.com/sefaction/MTG-Archives/issues/1021). These features can attach to the existing routes. Navigation uses the existing owner, public visibility, League, and Admin Mode checks.

## Delivery and verification

Start with the shared signed-in menu and Inventory section links on the existing pages. Move Settings into the account controls and make the Add cards and Deck Tools shortcuts visible alongside their new section links before removing the old global entries. Then add the card-context hunt and round-trip navigation. For each slice, use [the existing capability crosswalk](CAPABILITIES.md) to check entry points and actions. The current route map comes from main `f7520063` and is source evidence. The following checks apply when the proposed navigation runs in the review app.

| Check | Expected result |
| --- | --- |
| Desktop sidebar and topbar, phone at 390 and 320 CSS px, and desktop at 200% zoom | The menu and Inventory links fit or wrap. Keyboard users can reach every destination, see focus, dismiss the phone menu with Escape, and identify the current section and page. |
| Start from a saved URL, then navigate Back and Forward | Inventory filters, selected deck, selected set, pricing context, CSV history anchors, and scan batch review return to the intended view. An in-progress capture or review retains its existing safeguards and work. |
| Start a hunt from a deck, a pasted list, and private card details | The chosen context is shown. A fixture with deck-committed and reserved copies reports only eligible storage. Returning restores the deck or card context. Planning creates no inventory or deck mutations. |
| Find all add, export, and history actions starting at Cards | Manual add, CSV import/export, scan setup, camera, upload, scan review, correction photos, and both histories are discoverable by name. Navigation alone starts no capture or write. |
| Follow the same links as a member, another owner, an anonymous visitor, and an admin in and out of Admin Mode | Existing private and public data boundaries hold. A private or privileged URL still enforces its own access checks. Public inventory and decks, League rules, and notification deep links remain usable. |

Sources for the current menu and context links are [ArchiveNavigation](../../../components/ArchiveNavigation.tsx), [Nav](../../../components/Nav.tsx), [PublicNav](../../../components/PublicNav.tsx), [DeckToolsNav](../../../components/DeckToolsNav.tsx), [ImportTaskNav](../../../components/ImportTaskNav.tsx), and the [Card Hunt service](../../../lib/card-hunt-service.ts).
