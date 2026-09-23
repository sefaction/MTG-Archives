# Dashboard, Pricing and Public workspaces

Issue #271 continues the shared task-navigation patterns without changing ownership, public visibility, or pricing ingestion.

| Task | Home |
| --- | --- |
| Personal summary and common collection actions | `/dashboard`; personal figures explicitly separated from the admin-only system overview |
| Current collection/location/deck estimates and historical collection trend | `/pricing` (Collection value) |
| Historical market gainers/losers/percentage movement | `/pricing?view=market` |
| Price freshness, missing coverage and provider health | `/pricing?view=data` |
| Shared collections | `/public`, `/public/inventory`, `/public/decks`; shared read-only context, active destination and authenticated return to Dashboard |

Pricing task links preserve provider, currency, finish, range and filter context. Applying filters also preserves that context instead of silently falling back to defaults. Current estimates always cover the full owned collection in USD and are independent of the historical filters. Non-USD cached prices are excluded rather than relabeled/converted; unpriced copies appear next to totals and affected table rows. All-unpriced groups show “Unavailable”; a real zero price remains $0.00. Cached values can be stale and provider/finish fallbacks remain possible. Historical results carry their distinct provider/currency/finish/range and latest-observed context. This does not introduce currency conversion or a new pricing provider.

Wide pricing tables scroll inside labeled keyboard-focusable regions, bounded to 32rem. The shared owner/public Deck library results have a 70vh scroll region, preserving the full table/cards, filters, folders and actions with intentional read-only differences. This bounds presentation, not database query size or memory; it is not server pagination. Inventory continues using its existing paged/infinite browser and server-enforced public scope. Signed-in Public viewers retain their existing actions on their own wishlist/decks; no public inventory editing is added.

## Evidence

Before coding, a synthetic public/owner fixture and the populated local snapshot were reviewed at desktop/phone, including anonymous Public home/decks/inventory and both Pricing views. Phone document overflow was reproduced and registered as #317. Source-confirmed cross-currency totals were registered as #318. Both are addressed in this batch.

`tests/ui/browse-pricing-workspaces.spec.ts` covers task navigation, admin/personal context, actual EUR-only/missing/zero prices, filter preservation, 1366/390/320px layouts, table keyboard focus, public/private deck isolation, anonymous navigation, six themes, enlarged text and unchanged physical quantities. Existing Inventory/Deck regressions cover shared workspace behavior. Exact revisions, checks and limitations are in WORK_CHECKPOINT.md and LOCAL_REVIEW_BUILD.md.

No acquisition implementation, playtest changes, production deployment, or permission redesign is included.
