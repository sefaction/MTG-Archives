# Public Wishlist sharing

Issue #1021 uses the existing account username at `/public/wishlist/[username]`.
Settings provides a link and copy button beside the category controls. Inventory
links retain their existing route and visibility rules. Dot segments and names
starting with `~` use the same escaped segment convention as public inventory;
other URL syntax is percent-encoded. Unknown or inactive accounts return 404.

Brian agreed on November 11, 2026 to share no categories by default for existing
and new accounts. The owner may select Manual wishes, Deck needs, From members
and Set Completion, including none. Changing sharing never deletes private
wishes. The setting is independent of default Inventory/deck visibility.

Public output contains card names, wanted quantities, printing/finish preferences
and selected category labels. Notes, deck names, trade partners, condition and
language details, storage and private source IDs are excluded from the projection.
The username identifies the shared account. Category choices are read on each
dynamic request for anonymous and signed-in visitors alike; query parameters do
not select another owner or enable a category. Responses are not cached.

Quantities retain their separate reasons: manual requested quantity, ordinary
deck demand after copies committed to that deck, open member-wish quantity, and
one copy per Set Completion target. Basic lands and League decks retain the
private Wishlist exclusions. Identical public preferences within a category are
combined; quantities across reasons remain separate. Sharing creates no stock,
reservation, fulfillment or deck-commitment action.

`publicWishlistCategories` is an empty-by-default User string array with a database
allowlist. The authenticated settings action updates only the acting account and
records a visibility audit in the same transaction. Public queries use explicit
selects and construct a dedicated DTO instead of publishing private Wishlist data.

Verification includes focused projection/URL tests and an opt-in disposable
PostgreSQL fixture. Run `scripts/verify-public-wishlist.ts seed`, the
`tests/ui/public-wishlist.spec.ts` desktop/phone cases with
`MTG_PUBLIC_WISHLIST_FIXTURE=1`, then `verify` and `cleanup`. The database script
requires `MTG_LOCAL_PILOT_TEST=1`, a UUID qualification identity and a named
`public_wishlist_*` database on loopback or `public-wishlist-db`. It checks real
quantity/League rules and twelve business-model fingerprints before retiring
only its fixture records. The runtime orchestrator separately checks all public
table rows and existing container identities. Production and user acceptance
remain separate from local checks and merge.
