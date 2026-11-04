# Normal Wishlist excludes Commander League decks (#1002)

The normal Wishlist now queries only decks without a `commanderLeagueDeck`
relationship. This happens before aggregation, so League cards, sources, demand,
costs, filters, details and both table/binder views share the same boundary.
Ordinary Commander-format decks and manual wishes remain included. Inventory is
still queried independently, including physical copies stored with excluded
decks; those committed copies do not become available stock.

All three Wishlist printing actions reject League targets before optimization or
editing, and recheck the relationship after the existing owner/deck write locks.
The shared single-card commitment action used by the Wishlist also rejects League
decks before inventory access and rechecks after locking. Existing ownership,
transfer, trade reservation and League submission restrictions remain in force.

## Author verification — November 4, 2026

Base: `a4aa01c39b8d1d0ead4ba9b0d9cf464d6c557ce6`. The PR records the final head
and hosted checks. Local evidence is in the task checkout's ignored
`.local-data/evidence/` directory.

- **80 unit regressions pass**, covering Wishlist, deck ownership/commitment,
  trade policy and trade Wishlist. The new 25 action controls execute the actual
  server modules with request/runtime boundaries supplied by the test and the
  real write fence. They cover direct/admin and stale League requests, normal
  Commander printing changes, ownership transfer and reserved-deck refusals.
  Against the original action sources, 14 controls fail and 11 pass; the fixed
  sources pass all 25.
- **57 actual PostgreSQL checks pass** in a newly created, separately owned
  `wishlist_league_1002` database. Active/completed/archived Leagues, a frozen
  submission, League-only/shared cards, ordinary Commander/foreign owners, manual
  wishes and League-location stock are represented. Actual normal printing
  changes, a physical commitment/audit and manual quantity edits succeed; rejected
  League requests preserve stock, wishes, League rows/cards and submissions.
  The shared physical copy total is conserved across the authorized normal move.
- A read-only comparison on the same populated fixture returns **Need 32 / Get
  31 / $1,672 / five deck sources** with the old query and **Need 5 / Get 4 / $17 /
  one normal deck source** with the fix.
- **Production `npm run build` passes**, including lint/type checks, static
  generation and all 13 client manifest contracts. One existing
  `InventoryBrowser.tsx` effect-ref warning remains. Unchanged dependencies/schema
  were reused from the retained laptop review image; the full candidate source
  came from a fresh Git tree archive, with no old application sources overlaid.
- **Two Chromium cases pass**, at 1366×900 and 390×844, against that production
  build on a separate loopback port. They cover exact fixture totals, table/binder
  rows, ordinary detail links and action IDs, League/normal deck filters and
  Manual/Deck/Ready/Get tabs. Both saved full-page screenshots were inspected.

Retained harness failures: the expanded SQL test initially read other-deck
commitments from the group aggregate instead of the per-deck source; corrected
assertions verify both committed totals and per-deck counts. Browser preparation
first matched explanatory Need text, then encountered the existing saved Binder
preference during table filters. The final selectors target summary metrics and
explicitly choose Table View; original expected values and time limits remain.
These are fixture/selector failures, not an unexplained application failure.

## Reproduction

Run the ordinary focused tests:

```text
node --import tsx --test tests/wishlist.test.ts tests/wishlist-league-actions.test.ts tests/decks.test.ts tests/deck-inventory.test.ts tests/deck-trade-policy.test.ts tests/trade-wishlist.test.ts
```

For real SQL verification, create a fresh empty PostgreSQL database named
`wishlist_league_1002` on loopback or the owned `mtg-1002-db` container. Set its
`DATABASE_URL` and `MTG_WISHLIST_LEAGUE_FIXTURE=1`, deploy migrations, then run
`npx tsx scripts/verify-wishlist-league.ts`. The script refuses other database
names/hosts and populated User/Card tables, uses synthetic identities and blocks
external catalogue requests. It deliberately leaves its reproducible fixture for
the browser cases. Hosted CI runs it in a separate database after the existing
trade Wishlist conservation test.

Build/start this candidate against that disposable database. Set
`PLAYWRIGHT_BASE_URL` to its isolated loopback URL and
`MTG_WISHLIST_LEAGUE_FIXTURE=1`, then run
`npx playwright test tests/ui/wishlist-league.spec.ts`. The fixture-only browser
cases are skipped in ordinary runs against an installed application.

Independent review, required final-head CI and merge remain separate gates. This
work changes no production installation, hardware, schema or saved user data.
