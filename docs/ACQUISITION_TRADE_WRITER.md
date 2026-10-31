# Complete trade and reverse-import acquisition schedules

Related to #309/#302. This finishes the recorded complete trade-action gap and
the opposite CSV ordering in the named P7 writer matrix. Production algorithms,
schema, transaction options, retry and advisory-capacity policies are unchanged.

## Actual boundaries and results

The trade verifier loads the unchanged `app/trades/actions.ts` with the same
request-identity/Next-cache adaptation used by existing trade CI. It calls real
`confirmPhysicalTrade`, including confirmation, source locks, both transfers,
audits, wishlist fulfillment, completion history and notifications. It does not
replace the action with `receivedTradeInventoryData`. The complete real first
transaction body pauses before commit; PostgreSQL must identify the exact named
waiting connection and its named blocker within five seconds. Both operations
drain before disconnect or cleanup, with primary/secondary failures preserved.

Three independent fixtures use two ordinary participants, a separate admin,
two printings, source and incoming locations, one unchanged resident and two
matching plus one unrelated wishlist. One manually reviewed metadata-only photo
uses the existing persisted-capture contract; there is no original-image,
provider, recognition or browser claim.

- **Trade first:** actual completion fills the selected destination. Acquisition
  waits, refuses its stale preview with its complete scoped ledger unchanged,
  and requires a fresh preview and separate reason for one excess copy.
- **Acquisition first:** its complete receipt blocks the real trade completion.
  The later ordinary transfer retains advisory capacity semantics and leaves the
  acquisition receipt, membership and single-copy authority intact.
- **Transfer rollback:** after the actual completion body has written both lots,
  four audits, wishlists, event and notifications, an explicit fault rolls that
  transaction back. Waiting acquisition may use its still-valid preview because
  the failed transfer changed no capacity. Its one receipt survives. Complete
  trade/source/audit/wishlist/event/notification state matches the separately
  saved physical-confirmation boundary. The existing explicit admin force/reason
  action then completes once. This preserves the current two-transaction policy;
  it does not invent automatic or ordinary-user reconfirmation recovery.

All cases verify source decrements and exact before/after audits, distinct
received provenance and attributes, per-printing quantities, released trade
reservations, exact resident/unrelated wishlist conservation, proper notification
recipients and event counts, one capture receipt/member/audit, immutable photo
metadata and seven-day retention. Frozen acquisition replay and a duplicate real
trade action change no ledger. There are no external notification destinations.

The existing complete acquisition verifier adds **acquisition-first CSV**: hold
the full capture receipt, observe actual `commitImportBatch` blocked by that
connection, then preserve the original receipt/member/photo/audit while ordinary
CSV adds a distinct lot. Import status and row membership are exact. Both actual
service replays have zero effects. The existing CSV-first case is unchanged.

Every fixture uses generated owners/IDs and full public-table row fingerprints
without volatile exclusions. Local PostgreSQL16/current81-model Prisma client
and94migrations pass all three trade cases and the complete affected commit
verifier, including reverse CSV. Each trade case and each full-run baseline is
restored across85tables. A private negative removes only the actual stale-preview
comparison: the first real-action case fails its required stale-refusal assertion,
restores all85tables and restores exact production-source bytes in `finally`.
That is verifier sensitivity evidence, not a newly reproduced product defect.

Local dependency image4b5ffc is reused with source/client binding, not presented
as a newly built application. The owned internal-network Node768MiB/PG384MiB,
one CPU each/no extra swap fixture has no host ports or persistent volumes.
Exact source, negative/final logs, schema/client, fingerprints and retirement
receipts remain in the author checkpoint. Final-head CI, independent review and
terminal retirement are recorded on the PR; unfinished gates keep it draft.

## Finite P7 acceptance reconciliation

These are the original phase requirements, not an expanding list of newly
invented qualification tickets. Each result retains its actual source and limit.

| Original P7 requirement | Evidence and review dependency |
| --- | --- |
| Transaction-aware lots, provenance, notes, source, opener, pull/round and quantities over999 | `verify-inventory-receipts.ts`/`verify-import-commit.ts` preserve distinctions, rollback and a1200-copy receipt. The intentional500-photo acquisition transaction bound is separate. |
| Exactly-once explicit selected copies, request identity, retry/new key and immutable membership | `verify-acquisition-commit.ts` covers concurrent/replayed receipts, identity conflicts, new-key refusal, immutable membership and replay after later stock mutations. Existing explicit handoff/browser evidence remains separately scoped. |
| Full actual ordinary writer coordination | CSV-first #920 and this reverse CSV; manual-first #944 and acquisition-first #948; both move/deck/layout orders #948; both complete trade-action orders here. Each must pass its own final-head checks/review and resolving merge. |
| Deterministic coordination, retry and atomic failure | Enabled sorted statement/location/source locks and actual blocking pairs; whole-transaction serializable acquisition/import retry; audit/member/receipt-create faults, plus complete transfer rollback here. Existing safe refusal/admin recovery is explicit, not a universal deadlock-free or automatic-retry claim. |
| Current physical state, pending subset, ownership/actor and saved review | Existing commit/readiness/auth/current-generation controls; owner/finish/layout and actual receipt-create rollback #925. No silent UNKNOWN finish or unconfirmed physical count is introduced. |
| Fresh override,263-to258 and five pending reassignment | #927 completes real desktop/phone subset, separately confirmed alternate Add5, immutable first receipt, exact258+5membership/replay; independent overfill path remains. |
| Quantity/capacity collection envelope | Existing capacity test covers150000copies/60000stacks/four uneven owners/400locations/4000sections. This is a bounded occupancy/write result, not sustained full-application latency. |

### Current delivery state — October 24, 2026

The named deliveries are now merged: #920 (`3b06f208`), #925 (`9cd09484`),
#927 (`55d10d32`), #944 (`effa5fd8`), #948 (`6f02b2e5`) and this batch's
#950 (`8bdfed46`). Their exact qualification runs remain separately bound;
merging does not establish one new cumulative runtime pass. The
[current P7 reconciliation](ACQUISITION_WRITER_MATRIX.md) links every delivery,
original requirement, covered boundary and existing release remainder.

#309 remains OPEN for acceptance of that finite map and its broader
phase/release completion boundary. Its recorded closure refusal is preserved;
this reconciliation does not retry closure, change labels or silently transfer
requirements. Shared-phase/provider/recognition/native integration and installed
release acceptance are not claimed by this table.

Long-running mixed-writer/resource workloads, host/power/storage loss and
installation acceptance remain #310 release criteria. Separately merged
browser #960, database #962 and web-server #963 qualify their declared controlled
interruption/retry cases, with original source and conservation limits; those
cases are no longer wholly untested. Existing software faults are not proof of
every power-loss schedule. Other capture methods
remain deferred under #442/#443/#312 and the fi-7160 priority decision. This report
does not demand repeated ordinary physical qualification, change production or
authorize a merge. Partial/merged-lot browser variants and arbitrary multi-statement
histories retain their domain/release limits rather than generating more tickets.
