# P7 Inventory writer acceptance map

This reconciles #309's recorded all-writer requirement against current source,
not just the original phase delivery. It is a partial acceptance map, not closure
of #309/#302, named-installation deployment or independent user acceptance.
Current source base: maindb764847. This batch changes only database verification
and this report; receipt, capacity, import, trade, deck and acquisition behavior
are unchanged. Whole-deck #807/#881 is merged; the separate #913/#914 owner and
the approved integration coordinator retain their scopes.

## Writer and ordering coverage

| Writer | Actual exercised boundary | Evidence and limit |
| --- | --- | --- |
| Acquisition | commitAcquisitionCards uses the session/candidate fences, locked capacity read, shared receipt and unique member transaction | verify-acquisition-commit.ts: simultaneous same-request replay and competing sessions; rollback at receipt/audit/member stages; real stale-review rejection. Not every other writer composition. |
| CSV import | commitImportBatch executes under the capacity gate in verify-inventory-capacity.ts | Gate-first actual service lock wait. This batch additionally pauses the actual CSV transaction after stock/audit/status writes, then observes the actual acquisition commit waiting in PostgreSQL. The stale preview must reject with zero acquisition receipt/member/audit effects; fresh explicit overfill records its reason and exactly one copy. |
| Manual add | addInventoryCardToLocation and complete commitAcquisitionCards execute in both orders | verify-acquisition-writers.ts observes the actual named blocking pair after the first complete transaction body. Ordinary-first stale admission rolls back every scoped field; fresh explicit overfill/replay is verified. Acquisition-first permits the later advisory write without repeating its receipt. |
| Storage move | moveInventoryStorageBatch and complete commitAcquisitionCards execute in both orders | Same complete-service schedule and exact source-lot/quantity/provenance conservation, not just a capacity read. Acquisition-first preserves the documented serialization refusal with zero move effects, then a separate fresh call succeeds. Full-stack movement is covered; partial splits and every arbitrary multi-location schedule remain distinct. |
| Trade receipt | receivedTradeInventoryData followed by the real Inventory insert executes behind the gate | This is a receipt-helper/database boundary, not the full authenticated trade lifecycle. Separate actual trade stock/action tests qualify their own scopes; they do not establish a full trade-versus-acquisition interleaving. |
| Deck return | returnCommittedInventoryFromDeck and complete commitAcquisitionCards execute in both orders | Whole-lot return to No section preserves original lot fields and existing destination stock. Other deck operations and every partial/merge schedule remain distinct. |
| Layout edit | updateLocation and complete commitAcquisitionCards execute in both orders | Actual layout shrink invalidates the old preview, or follows the already committed receipt under advisory capacity. Its real update statement is enclosed in a fixture transaction only to hold the statement lock for observation; this is not a new production transaction or authenticated browser edit. |
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
| Atomic Inventory/audit/receipt/membership | verify-acquisition-commit.ts injects audit/member failures after earlier writes; original stock/audit/member counts are compared. Shared receipt tests cover insert/increment audit rollback. | These are declared software faults. A fault specifically at AcquisitionCommit creation is not individually injected here; natural disk loss and full host crashes remain distinct. |
| Subset/pending/retake/current physical count | verify-acquisition-commit.ts checks selected subset, unsettled/uncertain/overflow refusals, abandoned retake and unchanged pending photos | Device/provider acceptance remains deferred; current scan originals are not replaced by recognition guesses. |
| Fresh capacity and reasoned overfill | Existing competing-session/stale-destination/review checks and this actual CSV-versus-acquisition case; new preview sees zero space/one excess and explicit retry audit | The exact263-to258/five-pending reassignment UI scenario is not established by a two-copy database case. |
| Owner/active actor/review/finish/layout changes | Existing stranger/inactive-user, changed review, incompatible/unknown finish checks and placement-field revision trigger | Enumerate missing complete-commit invalidations for owner/finish/layout rather than treating trigger inspection as every composition passing. |
| Opener/source/notes/pull/round/lot | verify-inventory-receipts.ts and verify-import-commit.ts preserve distinctions, separate scan lots, compatible manual merging and concurrent before/after audits | Neither helper qualification nor one capture group proves every mixed provenance workload. |
| More than999 copies | verify-inventory-receipts.ts verifies a1200-copy receipt without the manual UI clamp; integer bounds/rollback remain | Acquisition intentionally selects at most500photos per receipt. The shared receipt quantity requirement does not authorize enlarging that transaction bound; broader scale/duration remains #310. |
| Collection envelope | verify-inventory-capacity.ts uses150000copies/60000stacks/fourunevenowners/400locations/4000sections and enabled-trigger checks | One-printing write/occupancy scale is not full application or all-writer latency. |

## Complete ordinary-writer compositions

The four ordinary services above each run ordinary-first and acquisition-first,
eight named schedules in total. The first transaction body performs all its real
work, then pauses before commit. PostgreSQL must identify the waiting connection
and its actual named blocker within the existing five-second observation window.
Results and SQL are not mocked. Both operations are always released and awaited
before either client disconnects or exact-owned rows are removed.

Ordinary-first compares the refused acquisition's complete stock, audits,
receipt/membership, candidates, photos, jobs, locations and session against the
snapshot taken inside the completed ordinary writer. A fresh preview and a
separate reason are then required for one excess copy; missing confirmation has
zero effects. Acquisition-first preserves its one receipt through the later
ordinary write. The older serializable move explicitly refuses with its existing
refresh-and-retry message; its full rollback is compared to the held acquisition
ledger before a separate fresh ordinary call succeeds. No production retry policy
is changed. Both orders verify frozen successful-request replay, exactly one
receipt/member/capture audit, ordinary audit accounting, quantities, complete
unchanged resident rows, original photo metadata and explicit seven-day retention.
Move/return preserve every lot field except the intended location and update time.

These cases are invoked from the existing complete verifyAcquisitionCommit and
required Acquisition PostgreSQL CI. They use synthetic persisted photo/review
fixtures and actual domain services, not an authenticated browser/provider/native
run, natural process/disk loss, full trade/acquisition lifecycle interleaving or
global deadlock freedom. Existing full gate-first, direct SQL, CSV, scale,
rollback, authorization and transport evidence remains separately scoped.

Final local/CI source binding, run results, cleanup fingerprints and any failed
verifier attempts are recorded in the PR. Test/documentation changes require no
application image reload or repeated browser qualification.

## Earlier CSV batch evidence (preserved)

The earlier batch added one missing concurrent-write composition: real CSV import versus
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

Keep #309 open. The table distinguishes direct source mechanisms, helper/service
controls, composed writer schedules, UI and historical acceptance. Next select
one specifically missing complete writer composition or explicit invalidation
case; preserve original requirements and link existing reports instead of
continually widening this matrix. The whole-trade feature remains its owner's
batch. Other-provider/phone-device acceptance stays #442; release/host-loss and
capture-consistent recovery stay #310. Any deployment or merge needs its own
current authority. An individually approved merge of this test batch would add
one schedule and this map, not claim all P7 criteria complete.
