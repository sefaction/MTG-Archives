# Pasted decklist physical-copy investigation

[User report #808](https://github.com/sefaction/MTG-Archives/issues/808) remains unresolved. The installation/revision, failing list, exact visible error and failure boundary were not provided. Two focused asynchronous questions ask for the installation and exact error/list size or small failing list. No answer was available when these controls were recorded.

## Current local controls

Runtime source digestf12c4b44ff6726ba9afc5601c02eded60f5fb423b1ab433417b27d2af7d42bf0; the actual loaded hashes of all six affected action/panel/parser/manual-receipt/move inputs equal mainc5b5bd2 source. These controls concern this local review build, without claiming the reported installation has the same revision.

A disposable-owner one-card exact-printing test compares ordinary list-only import, selecting one physical copy and explicitly appending that same reviewed physical copy again. All return303 and reach the deck page. Deck quantities1/1/2, aggregate stock0/1/2 and audits0/2/4 are correct. No application/client error occurs. This successful control does not resolve the historical report.

The added black-box regression preserves this missing physical path: a two-copy list-only import leaves stock0/audits0, a reviewed one-copy physical import produces deck-list2/stock1/audits2, and a deliberate second append produces deck-list4/stock2/audits4. It verifies exact printing, NONFOIL, LP condition, FR language and the system deck destination, with desktop1440px and phone390px layouts. The complete original browser workflow passes9.395seconds, zero skips/retries/flaky. Types pass. Existing list-only coverage remains unchanged. This verifies deliberate append semantics, not automatic retry idempotency or an unobserved failure's atomicity.

Initial exact Condition label selection timed out before physical submission because the accessible select label includes option text. The role/name-prefix selector fixes only the harness; the same LP/quantity/location assertions pass. Original private trace/report/log are retained. A test-info owner journal now precedes fixture mutation; no passwords or session data enter the journal. Every fixture operation/deletion scopes its exact newly created owner. Runtime adapters change only container and endpoint strings.

## Boundaries and next step

No product/action logic changed and no application image rebuild is needed. This is regression/evidence work related to808, not a resolving fix. Keep the PR draft pending reporter evidence and reproduction, and keep808open. Once the failing installation, error and minimal list are supplied, reproduce that exact boundary, verify before/after atomicity and implement a narrowly justified repair. Do not infer a timeout, data loss, duplication, ownership or League defect from these successful cases. No broader scale guarantee follows.

Current scanner/manual source, native/runtime resources, historical803OOM and prior805/806input gate are preserved. Read-only803findings and proposed future809private memory-window diagnostics were saved before the new user-reported failure took priority; no native source changes were made. Automatic approval review rejected an809workflow-label change as reviewer-owned. The safe alternative left labels unchanged and continued evidence-only work. No merge/readiness transition or user review request is made.

Private reports, journal and traces remain ignored under .local-data/deck-paste-qualification. Required exact-head CI and cumulative file proofs are recorded in the PR after publication. Separate reviewer owns readiness, individual approval, merge and closure.
