# Shared Card Hunt workspace

Brian approved implementation and local review of the November 25 proposal.
Find cards and personal, opt-in Bulk cleanup share Inventory's visual language,
table/binder preferences, card-size grid and exact card-detail dialog. The
default is a full-width results workspace; Box-by-box adds a location selector.
Sources and initial preferences collapse after building a hunt.

Hunts can exclude a location (including descendants), a section or an exact
storage stack, then re-evaluate. Exclusions remain reversible and affect this
hunt only. Owned-printing choices constrain the unpulled remainder; users can
return to automatic preferences. Normal storage is consumed before Bulk Boxes,
even when optimizing boxes. Bulk fallback can be disabled.

Mark pulled tracks physical progress without reserving or moving Inventory.
Those exact copies consume shared availability before replanning, even if their
location is subsequently excluded. Partial pulls and different destination decks
cannot spend the same copies twice. Changes to a held lot are surfaced rather
than silently substituting another source. Browser-tab progress is private to
the signed-in account. Final commitment/handoff retains existing fresh stock,
reservation, target, ownership, replay and actual-printing checks.

Cleanup counts the full eligible collection before filtering source locations.
Keep this stack chooses other excess copies of the same printing, finish and
language; it never substitutes a different printing's excess. Search and sort
apply globally before server pagination. Source exclusions and physically pulled
progress are retained in each frozen confirmation and revalidated atomically.
Scan cleanup retains its original physical order/current-batch-only behavior.

`InventoryLocation.isBulk` records purpose independently of physical type and
layout. Purpose inherits through sub-locations. Existing `Bulk cleanup` locations
are backfilled and remain compatible. Bulk inventory remains owned, visible and
searchable, but outside the active keep-limit calculation. Creating a Bulk Box
uses independent top-level storage, starting at 1,000 copies with editable
capacity. Locations also offers explicit purpose tagging; it moves no cards and
preserves layout, capacity and visibility. Inherited purpose changes at the parent.

Cleanup selects an owned, active bulk destination and optional section. Visible
capacity is advisory; confirmation locks and rechecks actual physical occupancy.
Existing provenance and private history are preserved, and lost replies recover
through the original durable request. Purpose changes coordinate with the same
owner/location write gates.

The additive migration runs through normal web startup/stop-pull-start. No new
Compose, environment, model or worker configuration is required. This batch is
stacked on the separately reviewable public Wishlist browser PR; merge and
production changes require Brian's separate approval.
