# Inventory browsing contract

Brian's November 25, 2026 report concerns price order disagreeing with displayed
values and foil/nonfoil copies appearing in one stack. The follow-up prioritizes
Inventory as a front-facing page. This batch audits shared signed-in/public
initial pages, list APIs, grouped/exact modes, pagination/infinite scroll, price
filters, selection and exports. It changes presentation/query boundaries, not
stored card quantities, prices, ownership, reservations or provenance.

- Exact printing rollups retain separate nonfoil, foil and etched rows. Grouped
  by card combines editions of the same oracle card within one finish. Source
  IDs remain attached to their physical stacks; controls identify the finish.
- Price order uses the same unit price, finish and preferred-source selection
  as the displayed label. Missing finish quotes stay unknown; another finish's
  price never fills the gap. Genuine zero prices remain sortable. Different
  currencies have stable separate buckets (USD first); no exchange conversion
  is implied. Missing values sort last in either direction.
- For a card grouped across editions, ascending/descending price chooses its
  lowest/highest matching printing as the visible representative. Hydration
  preserves that choice. Equal values have stable finish/owner/attribute ties.
- The advanced USD range is explicitly Scryfall USD for that finish. Filtered
  counts, all-matching actions and exports use the same printing/finish scope.
- Page hydration intersects existing ownership, visibility and search filters
  with the selected finish groups. It cannot expand to another finish or erase
  an existing OR filter. Public default mode agrees with the page's exact mode.
  SSR/list IDs agree so infinite scroll cannot reappend the initial rows.
- Source, visibility and owner sorting uses the labels actually displayed.
  Mixed source/visibility and multiple-owner aggregates are identified honestly;
  public owner names use public aliases. Public controls and personalized owner
  locks/pricing suppression keep their existing authority boundaries.

Qualification includes retained baseline failure evidence, focused controls,
the disposable PostgreSQL verifier `scripts/verify-inventory-price-finishes.ts`,
and actual compiled desktop/phone API/browser checks. The SQL verifier requires
`MTG_INVENTORY_SORT_TEST=1` and the exact isolated `inventory_sort_fixture`
database on its documented local/CI hostname. It never runs against production.
No schema, environment or Compose change is required. Individual PR merge,
deployment and user acceptance remain separate from author qualification.
