# P7 Inventory writer acceptance map

This reconciles #309's recorded all-writer requirement against current source,
not just the original phase delivery. It is a partial acceptance map, not closure
of #309/#302, named-installation deployment or independent user acceptance.
Original composed-writer source base: main339188b0. The capacity/reassignment
browser extension integrates main932e305c; its browser test/report/map changes
leave receipt, capacity, import, trade, deck and acquisition services unchanged.
Each earlier result retains its source/environment binding; no complete current
all-writer composition or phase acceptance follows from updating this map.

## Writer and ordering coverage

| Writer | Actual exercised boundary | Evidence and limit |
| --- | --- | --- |
| Acquisition | commitAcquisitionCards uses the session/candidate fences, locked capacity read, shared receipt and unique member transaction | verify-acquisition-commit.ts: simultaneous same-request replay and competing sessions; rollback at receipt/audit/member stages; real stale-review rejection. Not every other writer composition. |
| CSV import | commitImportBatch executes under the capacity gate in verify-inventory-capacity.ts | Gate-first actual service lock wait. This batch additionally pauses the actual CSV transaction after stock/audit/status writes, then observes the actual acquisition commit waiting in PostgreSQL. The stale preview must reject with zero acquisition receipt/member/audit effects; fresh explicit overfill records its reason and exactly one copy. |
| Manual add | addInventoryCardToLocation executes behind the gate; writer-first serializable capacity read retries | Actual helper/transaction, occupancy/revision checks, verify-inventory-capacity.ts. The writer-first acquisition side was the capacity read, not the complete receipt service. |
| Storage move | moveInventoryStorageBatch executes behind the gate | Actual service gate-first lock wait, verify-inventory-capacity.ts. Opposite-order complete acquisition/move composition is not asserted. |
| Trade receipt | receivedTradeInventoryData followed by the real Inventory insert executes behind the gate | This is a receipt-helper/database boundary, not the full authenticated trade lifecycle. Separate actual trade stock/action tests qualify their own scopes; they do not establish a full trade-versus-acquisition interleaving. |
| Deck return | returnCommittedInventoryFromDeck executes behind the gate | Actual service gate-first lock wait. Other deck operations rely on the same statement triggers; a full opposite-order deck/acquisition composition is not claimed. |
| Layout edit | updateLocation executes behind the gate and changes the revision | Actual service plus placement-field trigger coverage, verify-inventory-capacity.ts. Complete simultaneous receipt/layout composition remains distinct. |
| Delete/direct SQL/FK | real delete, SQL section/key/null-location changes and trigger checks | Database mechanism coverage across positive stock, revision/rollback and enabled triggers. Not an exhaustive enumeration of arbitrary SQL/writer histories. |

The common statement triggers touch affected locations in sorted identifier
order; the transaction-only capacity helper also sorts distinct destinations.
Whole serializable acquisition/import retries preserve all-or-nothing effects on
40001/40P01/P2034. This establishes the mechanism and tested schedules, not global
deadlock freedom for every multi-statement writer. Ordinary later mutations may
overfill by design; this is advisory capacity, not a new hard stock constraint.

## Other P7 requirements mapped

| Requirement | Current verification | Limit / next uncovered boundary |
| --- | --- | --- |
| Retry, double click, new key and lost response | verify-acquisition-commit.ts same-request concurrency/replay, changed digest refusal, unique membership/new-key denial and replay after stock deletion; existing explicit handoff browser report | Source/database replay is distinct from every transport failure or current installed UI. |
| Atomic Inventory/audit/receipt/membership | verify-acquisition-commit.ts injects audit, AcquisitionCommit-create and member-create failures after earlier writes; all fields of the scoped session/candidate/photo/stock/audit/receipt/member rows are compared. Shared receipt tests cover insert/increment audit rollback. | These are declared software faults at actual Prisma create/createMany boundaries, not natural disk loss or full host crashes. |
| Subset/pending/retake/current physical count | verify-acquisition-commit.ts checks selected subset, unsettled/uncertain/overflow refusals, abandoned retake and unchanged pending photos | Device/provider acceptance remains deferred; current scan originals are not replaced by recognition guesses. |
| Fresh capacity and reasoned overfill | Existing competing-session/stale-destination/review checks and the actual CSV-versus-acquisition case; new preview sees zero space/one excess and explicit retry audit.263-to258 desktop/320px cases verify stale refusal,258subset, five-pending destination preview then separate explicit addition there, first receipt/audit preservation,263unique memberships, reload/frozen-request replay, and separately fresh263overfill consent/audit. | The larger UI case uses explicit persisted reviewed fixtures and a database occupancy write, not263provider acknowledgements or an authenticated manual-add interleaving. The alternate-destination commit is now exercised with immutable first receipt and zero replay effects; whole provider/native/all-writer acceptance remains separate. See ACQUISITION_CAPACITY_HANDOFF.md. |
| Owner/active actor/review/finish/layout changes | Existing stranger/inactive-user, changed review and incompatible/unknown finish checks; complete commit now rejects changed persisted session owner, destination layout and a legitimately saved compatible finish after preview, preserving scoped rows/fields. Fresh preview exposes the new finish. | Owner/layout use explicit fixture database mutations; finish uses the real saved-review service. These are persisted invalidation controls, not concurrent authenticated ownership/layout editing schedules or every writer composition. |
| Opener/source/notes/pull/round/lot | verify-inventory-receipts.ts and verify-import-commit.ts preserve distinctions, separate scan lots, compatible manual merging and concurrent before/after audits | Neither helper qualification nor one capture group proves every mixed provenance workload. |
| More than999 copies | verify-inventory-receipts.ts verifies a1200-copy receipt without the manual UI clamp; integer bounds/rollback remain | Acquisition intentionally selects at most500photos per receipt. The shared receipt quantity requirement does not authorize enlarging that transaction bound; broader scale/duration remains #310. |
| Collection envelope | verify-inventory-capacity.ts uses150000copies/60000stacks/fourunevenowners/400locations/4000sections and enabled-trigger checks | One-printing write/occupancy scale is not full application or all-writer latency. |

## This batch's bounded test and evidence

Only one missing concurrent-write composition is added: real CSV import versus
real acquisition commit, writer first. The import transaction is held only at an
observation boundary after its actual stock/audit/status work. No result or SQL
is mocked. A separate application-named Prisma client starts the actual capture
commit; pg_stat_activity must prove a Lock wait within the existing five-second
observation envelope before the writer is released. Failure still releases and
awaits both transactions before disconnect/owned cleanup. Existing deadlines,
assertions and all prior cases remain; no global lock/limit change.

The new case is part of the existing verifyAcquisitionCommit invocation in
scripts/verify-acquisition-store.ts, hence required Acquisition PostgreSQL CI.
The existing import gate invokes both verifyInventoryCapacity and
verifyInventoryReceipts. Final-head CI and any local focused run are recorded in
the PR. Keep qualification draft until those checks actually finish.

Changed-file lint passes. An initial whole-project typecheck under an inadequately
small256MiBNodeheap exhausted that explicit heap; preserve typecheck.log and do
not count it as a type pass or host/Docker OOM. Required Core CI is the current
full typecheck gate. No app build/reload is required for test/documentation-only
changes; a disposable local database is isolated from all current review data.

## Remaining acceptance and next safe step

The subsequent persisted preview and receipt-create controls are documented in
[ACQUISITION_COMMIT_INVALIDATION.md](ACQUISITION_COMMIT_INVALIDATION.md). They add
the explicitly mapped owner/finish/layout and receipt-create evidence without
claiming a concurrent complete writer schedule or changing the earlier CSV case.

Keep #309 open. The table distinguishes direct source mechanisms, helper/service
controls, composed writer schedules, UI and historical acceptance. Next select
one specifically missing complete writer composition or explicit invalidation
case; preserve original requirements and link existing reports instead of
continually widening this matrix. The whole-trade feature remains its owner's
batch. Other-provider/phone-device acceptance stays #442; release/host-loss and
capture-consistent recovery stay #310. Any deployment or merge needs its own
current authority. An individually approved merge of this test batch would add
one schedule and this map, not claim all P7 criteria complete.
