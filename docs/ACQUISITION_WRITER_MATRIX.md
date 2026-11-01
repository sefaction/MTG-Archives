# P7 Inventory writer acceptance map

## Current accepted P7 status — October 31, 2026

[#309 is closed as completed](https://github.com/sefaction/MTG-Archives/issues/309#issuecomment-6387769493) under the accepted October 24 finite
transactional boundary: quantities and provenance; exactly-once receipts and
selected membership; ordinary writer coordination, locking and rollback;
saved-review precedence; and capacity, subset and reassignment behavior.
[PR #974](https://github.com/sefaction/MTG-Archives/pull/974) reconciled the named
writer deliveries against those original requirements. Its accepted reconciliation
identified no missing original named writer scenario.

The earlier closure refusal, open-phase instructions and review waits below are
preserved history from before that accepted boundary. They are not current
instructions to reopen #309, repeat the finite reconciliation or reimplement
already delivered writer schedules. The evidence tables and their source,
conservation and coverage limits remain unchanged.

#302 and #310 remain open. Sustained mixed workloads and resources, host/power/
storage loss, cross-layer recovery and installation acceptance remain the
separate release requirements recorded in the closing decision. Independent
recognition/accuracy keeps its existing trackers. This status correction creates
no new acceptance, scope transfer, runtime result, deployment or merge authority.
Select eligible remaining work from the live queue under its current owners;
ordinary fi-7160 operation does not need broad requalification.

## Preserved reconciliation — October 24, 2026

Related to [#309](https://github.com/sefaction/MTG-Archives/issues/309),
[#310](https://github.com/sefaction/MTG-Archives/issues/310) and
[#302](https://github.com/sefaction/MTG-Archives/issues/302). Reconciled against
main `751e1764`, the original P7 batches/acceptance/tests in #309 and the current
verifier entry points. The named complete-writer schedules below are merged.
Earlier statements that these deliveries await approval or integration describe
their original qualification dates; they are not current queue blockers.

| Delivered requirement | Verified resolving merge | Evidence and remaining limit |
| --- | --- | --- |
| Complete CSV-first/acquisition schedule | [#920](https://github.com/sefaction/MTG-Archives/pull/920), `3b06f208` | [Commit verifier](../scripts/verify-acquisition-commit.ts) observes the exact blocking pair, stale refusal and fresh reasoned overfill. Reverse ordering is delivered by #950 below. |
| Changed owner/layout/saved finish and receipt-create rollback | [#925](https://github.com/sefaction/MTG-Archives/pull/925), `9cd09484` | [Invalidation report](ACQUISITION_COMMIT_INVALIDATION.md): scoped full-row refusal/rollback and fresh finish preview. Persisted fixture changes do not establish every editing-route interleaving. |
| 263-to-258 subset, five-pending reassignment and fresh overfill | [#927](https://github.com/sefaction/MTG-Archives/pull/927), `55d10d32` | [Desktop/phone handoff](ACQUISITION_CAPACITY_HANDOFF.md) includes the separate Add5, immutable first receipt and frozen replay. The 263 inputs are controlled persisted reviews, not 263 native captures. |
| Complete manual-add-first/acquisition schedule | [#944](https://github.com/sefaction/MTG-Archives/pull/944), `effa5fd8` | [Manual-writer report](ACQUISITION_MANUAL_WRITER.md) and [verifier](../scripts/verify-acquisition-manual-writer.ts): exact PID wait, stale refusal, fresh consent and replay. Domain-service qualification, not browser authentication. |
| Acquisition-first manual addition; both storage-move, deck-return and layout orders | [#948](https://github.com/sefaction/MTG-Archives/pull/948), `6f02b2e5` | [Seven complete schedules](../scripts/verify-acquisition-writers.ts). Whole-lot move/return and the actual layout statement retain the limits below; arbitrary partial/merge and multi-statement histories are not inferred. |
| Both complete physical-trade-action orders, transfer rollback and acquisition-first CSV | [#950](https://github.com/sefaction/MTG-Archives/pull/950), `8bdfed46` | [Trade/reverse-import report](ACQUISITION_TRADE_WRITER.md) and [trade verifier](../scripts/verify-acquisition-trade.ts). Full action effects and explicit existing admin recovery are checked; physical exchange and every transport failure are separate. |

All six merge commits are ancestors of the reconciled main. Their reviewed
qualification reports and merge/CI records retain their original source,
environment, conservation denominators and failures. This documentation change
does not turn those separate runs into one new cumulative runtime execution.
The current hosted [Acquisition PostgreSQL entry point](../scripts/verify-acquisition-store.ts)
invokes the commit, manual-writer and trade-composition verifiers; the commit
verifier invokes the seven ordinary-writer schedules. The
[import CI job](../.github/workflows/verify.yml) runs
[`verify-import-commit.ts`](../scripts/verify-import-commit.ts), which invokes
the shared receipt and capacity verifiers before its import checks.

### Original requirements and completion boundary

The two tables below retain the finite original writer and other P7 requirements.
Together with the merged ledger above, they map all four original batches:
transaction-aware receipts/provenance; actual writer coordination; immutable
exactly-once selected membership; and fresh capacity/subset/reassignment UX.
The [shared receipt verifier](../scripts/verify-inventory-receipts.ts) covers
1,200-copy quantity, opener/source/notes/pull/round distinctions, compatible
manual merging and insert/increment audit rollback. Acquisition's separate
500-photo transaction limit remains intentional. Neither a helper pass nor the
bounded one-printing collection fixture establishes every mixed workload.

Keep #309 OPEN. Its current issue summary records an earlier automatic approval
review refusal of phase closure; this reconciliation does not retry that action
or change its labels. Named writer delivery is complete within the recorded
schedules. Acceptance of the finite phase map and the broader phase/release
boundary remains pending. No remaining work is silently transferred or declared
accepted merely by linking #310.

| Existing release/phase requirement | Delivered boundary to reuse | Still unqualified / next action |
| --- | --- | --- |
| Response loss and restart recovery | Merged [browser #960](ACQUISITION_BROWSER_LOSS.md), [database #962](ACQUISITION_DATABASE_LOSS.md) and [web-server #963](ACQUISITION_SERVER_LOSS_QUALIFICATION.md) cover their declared desktop/phone interruptions, rollback/durable receipt and explicit retry. | #310 retains host/power/storage loss and other source/native recovery. Browser controller-retained requests do not establish arbitrary in-flight UI persistence. Do not rerun the three delivered cases just because this map changed. |
| Capture-consistent backup and usable restore | [Capture restore](ACQUISITION_CAPTURE_RESTORE.md), merged #923, verifies a quiescent archive, exact source/target rows/files, revoked credentials and safe upload/receipt replay. #926 repairs the separate drill's guard/time interpretation. | #305/#310 retain broader installation restoration and failure boundaries. A quiescent synthetic route fixture does not qualify online backup, power loss or an installed user workflow. |
| Integrated throughput, sustained mixed workload and resources | Retain the dated 100/300-input and 150,000-copy results and failures under #310; the capacity fixture here is a bounded occupancy/write measurement. | #310/#760 retain current integrated sustained/varied native and resource acceptance. Select one missing revision/scenario from their evidence matrix after fresh ownership/capacity checks; do not enlarge the writer matrix with speculative combinations. |
| Recognition, saved decisions and installation/release acceptance | Existing source/database/manual-review fences and the separately delivered native integration remain scoped evidence. | #304/#307/#308/#302 and #310 retain their own accuracy, review/default and installed-release acceptance. The desktop owns the open language-default correction #958. Other capture methods stay deferred under #442/#443/#312; ordinary fi-7160 operation does not need broad requalification. |

The next safe P7 action is review of this reconciled map against #309's original
criteria. If a concrete original scenario is found missing, record that bounded
remainder on the existing issue with its inputs, expected conserved state and
stopping criterion. Otherwise continue an eligible existing release requirement;
phase closure still requires its acceptance/transfer boundary to be settled.
Brian's current instruction prohibits creating any new issue. Individual PR
approval, merge, named-installation deployment and user acceptance remain
separate. No product/runtime/data change or new runtime evidence is claimed.

## Preserved qualification context

This reconciles #309's recorded all-writer requirement against current source,
not just the original phase delivery. It is a partial acceptance map, not closure
of #309/#302, named-installation deployment or independent user acceptance.
Original composed-writer source base: main339188b0. The capacity/reassignment
browser extension integrates main932e305c; its browser test/report/map changes
leave receipt, capacity, import, trade, deck and acquisition services unchanged.
The seven ordinary-writer compositions use local basedb764847 and integrate
approved main502b18ed for final CI. Whole-deck #807/#881 is merged; the separate
#944 manual-first author and approved integration coordinator retain their scopes.
Each earlier result retains its source/environment binding; no complete current
all-writer composition or phase acceptance follows from updating this map.

## Writer and ordering coverage

| Writer | Actual exercised boundary | Evidence and limit |
| --- | --- | --- |
| Acquisition | commitAcquisitionCards uses the session/candidate fences, locked capacity read, shared receipt and unique member transaction | verify-acquisition-commit.ts: simultaneous same-request replay and competing sessions; rollback at receipt/audit/member stages; real stale-review rejection. Not every other writer composition. |
| CSV import | Complete commitImportBatch and commitAcquisitionCards execute in both orders | Existing #920 CSV-first stale/refreshed consent remains. The [reverse complete schedule](ACQUISITION_TRADE_WRITER.md) preserves the committed capture receipt/photo/audit while the later advisory CSV adds a separate provenance lot; both service replays have zero effects. |
| Manual add | addInventoryCardToLocation and complete commitAcquisitionCards execute in both orders across two owned deliveries | Desktop PR #944 supplies ordinary-first, exact-writer PID wait, stale/refused admission, reasoned retry and replay. verify-acquisition-writers.ts supplies the distinct acquisition-first schedule and actual named blocking pair; the later advisory write cannot repeat its receipt. Preserve both owners and their evidence; neither PR alone claims both cases. |
| Storage move | moveInventoryStorageBatch and complete commitAcquisitionCards execute in both orders | Same complete-service schedule and exact source-lot/quantity/provenance conservation, not just a capacity read. Acquisition-first preserves the documented serialization refusal with zero move effects, then a separate fresh call succeeds. Full-stack movement is covered; partial splits and every arbitrary multi-location schedule remain distinct. |
| Trade receipt | Complete confirmPhysicalTrade action and complete acquisition receipt execute in both orders | [Full action schedules and rollback](ACQUISITION_TRADE_WRITER.md) execute real transfers, reservations, audits, wishlists, events and notifications. Only request identity/cache and post-body observation are adapted; this is not an authenticated browser/physical exchange claim. Existing helper controls remain. |
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
| Atomic Inventory/audit/receipt/membership | verify-acquisition-commit.ts injects audit, AcquisitionCommit-create and member-create failures after earlier writes; all fields of the scoped session/candidate/photo/stock/audit/receipt/member rows are compared. Shared receipt tests cover insert/increment audit rollback. | These are declared software faults at actual Prisma create/createMany boundaries, not natural disk loss or full host crashes. |
| Subset/pending/retake/current physical count | verify-acquisition-commit.ts checks selected subset, unsettled/uncertain/overflow refusals, abandoned retake and unchanged pending photos | Device/provider acceptance remains deferred; current scan originals are not replaced by recognition guesses. |
| Fresh capacity and reasoned overfill | Existing competing-session/stale-destination/review checks and the actual CSV-versus-acquisition case; new preview sees zero space/one excess and explicit retry audit.263-to258 desktop/320px cases verify stale refusal,258subset, five-pending destination preview then separate explicit addition there, first receipt/audit preservation,263unique memberships, reload/frozen-request replay, and separately fresh263overfill consent/audit. | The larger UI case uses explicit persisted reviewed fixtures and a database occupancy write, not263provider acknowledgements or an authenticated manual-add interleaving. The alternate-destination commit is now exercised with immutable first receipt and zero replay effects; whole provider/native/all-writer acceptance remains separate. See ACQUISITION_CAPACITY_HANDOFF.md. |
| Owner/active actor/review/finish/layout changes | Existing stranger/inactive-user, changed review and incompatible/unknown finish checks; complete commit now rejects changed persisted session owner, destination layout and a legitimately saved compatible finish after preview, preserving scoped rows/fields. Fresh preview exposes the new finish. | Owner/layout use explicit fixture database mutations; finish uses the real saved-review service. These are persisted invalidation controls, not concurrent authenticated ownership/layout editing schedules or every writer composition. |
| Opener/source/notes/pull/round/lot | verify-inventory-receipts.ts and verify-import-commit.ts preserve distinctions, separate scan lots, compatible manual merging and concurrent before/after audits | Neither helper qualification nor one capture group proves every mixed provenance workload. |
| More than999 copies | verify-inventory-receipts.ts verifies a1200-copy receipt without the manual UI clamp; integer bounds/rollback remain | Acquisition intentionally selects at most500photos per receipt. The shared receipt quantity requirement does not authorize enlarging that transaction bound; broader scale/duration remains #310. |
| Collection envelope | verify-inventory-capacity.ts uses150000copies/60000stacks/fourunevenowners/400locations/4000sections and enabled-trigger checks | One-printing write/occupancy scale is not full application or all-writer latency. |

## Complete ordinary-writer compositions

The desktop's existing [PR #944](https://github.com/sefaction/MTG-Archives/pull/944)
supplies manual-add-first. This batch adds the seven distinct remaining schedules:
manual acquisition-first, and both orders for move, deck return and layout. The
first transaction body performs all its real
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

The initial local batch ran all eight before final reconciliation exposed the
existing desktop delivery. Its duplicate manual-first invocation was removed;
the other seven independent cases and all their assertions are unchanged. Reuse
of that local evidence is explicit; required final-head CI must execute all seven.
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

## Historical remaining-work handoff before the final resolving merges

The final named trade/reverse-import schedules and finite original P7 acceptance
reconciliation are in [ACQUISITION_TRADE_WRITER.md](ACQUISITION_TRADE_WRITER.md).
Read its #944/#948 dependencies and actual PR gate/merge states before treating
an earlier row or historical "next uncovered" statement as new work. Do not
repeat named schedules merely because their original map predates that evidence.

The subsequent persisted preview and receipt-create controls are documented in
[ACQUISITION_COMMIT_INVALIDATION.md](ACQUISITION_COMMIT_INVALIDATION.md). They add
the explicitly mapped owner/finish/layout and receipt-create evidence without
claiming a concurrent complete writer schedule or changing the earlier CSV case.

That earlier handoff selected a missing complete writer composition or explicit
invalidation case and left the whole-trade feature with its author. The merged
ledger and current completion boundary at the top now supersede that selection
instruction: the named cases are delivered, and no missing writer should be
invented to keep this phase busy. Original evidence, failures and acceptance
limits remain preserved. #309 stays open under its current criteria;
other-provider/phone-device acceptance remains #442 and cross-layer release
acceptance remains #310. Merge and deployment still need their own authority.

## Preserved manual-first acceptance row before the seven-schedule integration

The following dated delivery evidence remains applicable through PR #944; the current table above composes it with PR #948. The earlier storage-move limitation is superseded only by the separately qualified schedules above.

| Manual add | addInventoryCardToLocation executes behind the gate; writer-first serializable capacity read retries | Existing helper/transaction checks remain. [The complete writer-first acquisition composition](ACQUISITION_MANUAL_WRITER.md) additionally observes the exact manual writer PID blocking the actual commit, stale/unreasoned refusal, distinct reasoned receipt and effect-free replay; see that report/PR for executed status and limits. |
| Storage move | moveInventoryStorageBatch executes behind the gate | Actual service gate-first lock wait, verify-inventory-capacity.ts. Opposite-order complete acquisition/move composition is not asserted. |
