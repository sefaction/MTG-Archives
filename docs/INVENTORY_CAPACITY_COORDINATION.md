# Inventory capacity coordination

Acquisition confirmation needs a capacity decision that stays valid until its
receipt is written. Existing imports, moves, trades, Deck actions and location
edits retain advisory capacity behavior.

## Database boundary

Every Inventory insert, delete, or change to quantity/location/section/owner
advances `InventoryLocation.capacityRevision` on the affected locations within
the same transaction. Metadata-only stock edits do not change the token. Changes
to placement-relevant location fields advance it too. Deletion locks the location
row itself; a subsequent acquisition read fails if that destination is gone.

PostgreSQL statement triggers use transition tables to touch each affected
location once per statement, in identifier order. Bulk writes therefore avoid a
location update per stock row. Direct SQL and foreign-key actions use the same
boundary. A truncate trigger invalidates remaining locations. These are ordinary
transactional triggers, not deferred work or a background scheduler. See
[PostgreSQL 16 CREATE TRIGGER](https://www.postgresql.org/docs/16/sql-createtrigger.html).

`lockAndReadInventoryCapacity` requires a transaction client, locks its destination
and reads fresh direct occupancy, section occupancy, capacity and revision.
Multiple destinations must first be locked together in sorted order through
`lockInventoryDestinations`. Keep the locks through the receipt writes. Retry the
whole transaction on serialization/deadlock conflicts; never retry only an insert.
The existing serializable import/acquisition retry boundaries handle both Prisma
conflicts and PostgreSQL SQL states from explicit locks.

A writer that reaches the boundary first makes the acquisition read wait and
refresh. If acquisition holds the lock first, the other write cannot commit its
occupancy change until acquisition releases it. Ordinary later writes may still
overfill a destination by design. This is not a global hard capacity constraint.
Concurrent multi-statement operations can still deadlock; rollback and bounded
whole-transaction retry remain necessary. Unrelated locations have separate locks.

Direct occupancy includes every positive quantity physically assigned to the
location, including inconsistent legacy owner metadata, and excludes descendants.
Only the selected section's bound and the overall location bound apply. Unset
capacity stays unknown/unlimited; it is never treated as zero. Authorization,
session/candidate validation and reviewed-input identity remain caller duties.

## Verified scope

`npm run verify:acquisition` runs the capacity fixture in disposable PostgreSQL;
the same fixture runs in CI's PostgreSQL import gate. Tests observe actual
`pg_stat_activity` lock waits, not sleeps used as evidence:

- capacity gate versus manual add, CSV commit, bulk move, Deck return and location
  update service calls;
- the trade receipt helper's actual database insert and an actual stock deletion
  (not the entire trade authorization/physical-exchange workflow);
- writer-first ordering and a stale serializable acquisition snapshot that retries
  and sees the new occupancy/revision;
- whole-statement revision deduplication, metadata-only edits, rollback, direct SQL,
  primary-key/section changes, null destinations and unknown capacity.

The local scale fixture has 150,000 copies in 60,000 stacks, four uneven owners,
400 locations and 4,000 named sections. One local run took 11.60s to insert the
fixture and 4.26s to update all 60,000 quantities. In alternating rollback trials,
the update statement took 3.20–3.94s with coordination and 2.41–2.56s with this one
update trigger disabled. Disabling is transactionally rolled back and restricted
to the named disposable verifier databases; all four triggers were checked enabled
afterward. This is a bounded one-printing capacity/write benchmark, not a general
site latency or four-user HTTP throughput claim. Report:
`acquisition-2026-09-27T18-10-55-467Z` under ignored local verification output.

Local browser regression passed Imports, manual/Scan Inventory mutation, vault
moves, Deck editing/physical return, Trades, Locations and storage layout (nine
cases across the grouped run and focused trade rerun). Trade fixture cleanup was
split into independent deletes after its combined five-second transaction expired;
the application assertions passed unchanged.

The acquisition commit endpoint is not enabled by this batch. Unique candidate
membership, selected-subset preview, fresh overfill confirmation, explicit receipt
commit, photo retention and real Android acceptance remain required.
