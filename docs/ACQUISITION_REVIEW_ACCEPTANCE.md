# P6 review acceptance checklist (#308)

This reconciles the original three review batches, their acceptance/tests and the
kickoff amendment with delivered source and actual evidence. A checked-in test is
not itself a passing execution. Source mechanisms, historical author execution,
new controlled browser execution, independent review, merge, installation and
human acceptance remain distinct. #308 stays open; no criterion is silently
discarded and no recognition, device or release acceptance is inferred.

The current fi-7160 priority and Brian's accepted ordinary physical use govern
older phone/provider prerequisites. Phone review remains active; actual phone
capture and additional providers remain deferred under #442/#443. Do not repeat
broad scanner hardware qualification to complete this review checklist.

## Current reconciliation — October 23, 2026

Reconciled against main `f8246f070364e2d2fef28d1f5ce604918ce41c59`
and live GitHub merge records. The following are delivered, rather than awaiting
their original approvals:

| Delivery | Resolving merge | Evidence retained |
| --- | --- | --- |
| Count-only review preservation, #839 | [`a233461b`](https://github.com/sefaction/MTG-Archives/commit/a233461b0ccc8fa127a7b4994b3236c2b20794dd) | Persisted review/count/refill/explicit-commit chain; original failures and historical repair limits remain in its report. |
| Stable order and deterministic relation comparisons, #902/#903 | [`7e376cfe`](https://github.com/sefaction/MTG-Archives/commit/7e376cfe5d9e03dec183267ffb124ea4ddf04103) / [`e48d7280`](https://github.com/sefaction/MTG-Archives/commit/e48d72807ed3b1608e34c95b0280583d8a1a5ffa) | Physical ordering and test normalization are distinct; normalization does not explain the earlier failed interval. |
| Discard/save focus, #917/#919 | [`762546d8`](https://github.com/sefaction/MTG-Archives/commit/762546d84220b4bfa8fda092eb04ce442440a608) / [`3497b709`](https://github.com/sefaction/MTG-Archives/commit/3497b7090318cfa391d44d1e22a5db40b0ac527e) | Simple/Advanced desktop/phone focus, failed drafts and outside-focus preservation. |
| Stale previews and same-session reassignment, #925/#927 | [`9cd09484`](https://github.com/sefaction/MTG-Archives/commit/9cd094840bf1eefcb10efafec63d2f831135dbcc) / [`55d10d32`](https://github.com/sefaction/MTG-Archives/commit/55d10d321131b8464d087b68831debde64b73e65) | #927's final extension adds the remaining five cards separately and verifies frozen replay; its first preview-only run remains historical. |
| Hundreds-card themes/drafts/conflicts, #929 | [`52f8091e`](https://github.com/sefaction/MTG-Archives/commit/52f8091e78b8a38e0a7587ebef7add011cf1c953) | Three layouts, 36 theme/mode/layout states and 84-table browser cleanup comparisons; no native throughput claim. |
| Owner/Admin Mode/private-original review, #930 | [`58b7990c`](https://github.com/sefaction/MTG-Archives/commit/58b7990c152821a3c30658544dc21d938fb84aba) | Actual Enter/Exit Admin Mode and saved actor/history; 80-table db-push fixture, not migration-only protection qualification. |

All nine merge commits are ancestors of the reconciled main. Their PRs retain
individual approval, independent review and final integration CI evidence;
this documentation reconciliation does not rerun or relabel that evidence.
The 80-, 84- and 85-table fixture scopes remain separate. No complete current
application-image rebuild or installation acceptance follows from this ledger.

### Original P6 requirements still open

The original issue's three batches and kickoff amendment are the requirements,
not just the four status filters or the later browser fixture's assertions:

- **Problem-specific filters:** original Batch 2 names conflict, no match,
  unknown finish, quality and overflow filters as well as needs-review. Current
  `AcquisitionReviewFilter` and the capture-page selector offer only All,
  Awaiting review, Ready to preview and Added to Inventory. Showing a reason or
  grouping it under Awaiting does not establish a dedicated filter. These
  categories need an actual implementation/qualification or a recorded scope
  decision; the 300-card four-status test does not complete them.
- **Language/opener defaults:** original Batch 2 names batch finish, language,
  condition and opener defaults. `acquisitionDefaultsSchema` and the batch form
  currently contain finish and condition only. Selected printing language and
  UNKNOWN scan opener preserve current safe behavior, but do not prove the
  original defaults requirement delivered. Reconcile the original intent and
  any later explicit decision before changing printing/language or opener
  authority. No superseding decision is inferred here.

These remain under #308, with source references in the map below; no new issue,
acceptance transfer or product policy is created. First pursue the agreed
problem-filter requirement with bounded whole-batch metadata and unchanged
draft, privacy, pagination and explicit-commit protections. Resolve only a
material language/opener choice that existing recorded decisions cannot answer.
The remaining recognition, native, installation and deferred capture criteria
retain their existing receiving trackers at the end of this document.

## Requirement and evidence map

| Agreed requirement | Concrete source/evidence | Scope and remaining decision |
| --- | --- | --- |
| Persisted batch list, deep links and understandable progress | Batch dashboard/lifecycle UI and `ACQUISITION_BATCH_DASHBOARD.md`; actual browser lifecycle controls | Delivered software, distinct from every named installation or long-running native pipeline. |
| Saved printing, explained suggestions, local search and per-card attributes | `ACQUISITION_REVIEW.md`, `ACQUISITION_REVIEW_MODES.md`; `verify-acquisition-review.ts`, real-photo review steps | Existing source/database and recorded UI evidence; suggestions are not independent printing labels or accuracy percentages. |
| Batch finish/language/condition/opener defaults and overrides | `acquisitionDefaultsSchema`, `AcquisitionBatchDefaults`, full PostgreSQL review verifier and automatic-confirmation report | Finish/condition and supported per-card printing/language are delivered. Batch language/opener defaults remain unresolved above. UNKNOWN finish cannot silently commit; no opener or printing authority is widened. |
| Human correction survives count, refill, reload and explicit commit | Merged #839 and `COUNTED_REVIEW_PRESERVATION_QUALIFICATION.md` | Actual persisted and compiled desktop/phone chain. Its earlier failure and historical one-copy repair remain distinct; it does not authorize other Inventory repairs. |
| Separate ready, pending, uncertain and overflow physical totals | `acquisition-review-display.ts`, full store/commit verifiers, draft-actions UI; this300-card fixture has298ready/two pending with independent uncertainty/overflow | Controlled persisted evidence. A saved review does not erase uncertainty or free a physical slot. Unreviewed overflow first asks for printing; progress still reports OVERFLOW. |
| All/Awaiting/Ready/Added filters and stable physical order | Review modes and `SCAN_REVIEW_NAVIGATION.md`; merged candidate ordering #902; current controlled300-card filter/navigation case | Counts cover the full batch. Filtering starts a bounded page; normal sentinel loading can extend it. Intentional off-page navigation may reveal the requested later row. |
| Conflict/no-match/unknown-finish/quality/overflow problem filters | `lib/acquisition-review-display.ts`, capture-page filter selector and original #308 Batch 2 | Not implemented by the four status values. Reason visibility, physical blockers and a passing status-filter fixture do not substitute for these original filter categories. |
| Bounded hundreds-card review and retained source bytes | Existing100/300 presentation qualification recorded with paged-review cleanup; new300-card fixture exercises current controls | Presentation is separate from failed/unqualified native100/300 throughput and150000-copy integrated release criteria in #310. |
| Draft survival across modes, filters and reload | Browser-draft/status/action-guard reports and tests; new Simple/Advanced/six-theme/current300-card case | Browser storage is not cross-device authority. Save/cancel is explicit; unreadable/quota failures retain the existing guard behavior. |
| Competing edits are visibly refused without losing a newer draft | Full PostgreSQL review/history rollback controls; new actual second-user MP save followed by stale LP browser refusal and explicit cancel/reload | Same-player second user exercises a real separate actor, route/session/revision. It is not every owner/Admin Mode UI permutation; existing database tests retain their separate history/rollback evidence. |
| Retry and interrupted-response behavior | `ACQUISITION_BULK_RECOVERY.md`, draft-action/status tests and recorded real API response-loss controls | Frozen original payload/retry identities and existing server replay/conflict fences. Do not rerun unchanged transport positives merely because another PR waits. |
| Owner/Admin Mode and private originals/history | Merged #930 / `ACQUISITION_PRIVATE_REVIEW.md`, plus existing service/history controls | Actual authenticated owner/anonymous/foreign/ADMIN and Enter/Exit Admin Mode workflow passes at all three layouts. Its 80-table db-push scope and private-original/preview-refusal limits remain explicit; no named-installation or migration-only claim. |
| Missing worker, no match, empty alternatives and incomplete evidence | Processing-recovery/report controls; existing empty-search navigation checks; this fixture has no native workers and retains pending/corrected source | Controlled failure states, not diagnosis of historical worker exits or recognition success. Empty search cannot remove the saved printing/draft. |
| Stop, count uncertainty, refill and optional ordered-section acknowledgement | `SCANNER_SECTION_SERIES.md`, counted-feed and review-preservation reports; simulated protocol/browser and real PostgreSQL controls | Explicit next section/Start/refill and persistent Stop; no automatic feed or stock. Preserve original failed physical boundaries. Ordinary accepted operation is not complete helper/provenance/scale acceptance. |
| Other-session warnings and fresh destination revisions | Full store verifier checks pending3/stale destination; counted capacity API/picker and section-series UI checks held-space warnings/fresh section choice | Existing actual source/database/protocol UI evidence. Do not substitute generic phone reservations for counted fi-7160 semantics or treat advisory capacity as a global stock limit. |
| Selected subset, five pending, same-session reassignment and fresh overfill | Merged #927 / `ACQUISITION_CAPACITY_HANDOFF.md`, existing commit/receipt tests | Final desktop/320px case commits258, reloads five pending, previews without stock, then separately adds five elsewhere and replays the frozen request. First receipt/members/audit and all263 identities remain; all six migrated85-table cleanup pairs match. Earlier preview-only evidence is preserved separately. |
| Keyboard/Escape and successful save/discard focus | Real-photo review keyboard steps and merged PR917/919 qualification reports | Scoped Simple/Advanced1366/320 controls, outside-focus preservation and failed drafts. No blanket browser/assistive-technology certification. |
| Desktop1366x768, phone390/320 and all six themes | Current opt-in `acquisition-review-acceptance.spec.ts`:300 controlled cards, both modes, all `APP_THEMES`, real draft/conflict actions | New execution results/source binding are recorded below and in the PR. Theme switching here changes DOM theme only; persisted preference saving has separate tests. |
| Review, preview, refresh and navigation never create Inventory | Existing review/commit separation controls, merged #925/#927/#929/#930 | Review-only cases require zero new stock/commit/audit. #927's stock changes occur only after each separate explicit Add action, with receipt/replay conservation. Pending #944/#948/#950 writer compositions remain #309 delivery, not a passed universal writer schedule. |

## New bounded case and source binding

Each layout starts with one actual authenticated upload/review and299 explicit
persisted fixture copies, with separate slot/photo/candidate/artifact/observation
identities and actual original files. A declared uncertain saved card and one
unreviewed overflow card produce298ready/two pending. This is reviewed-state
setup, not300provider acknowledgements, labels, native jobs or physical cards.

The case checks bounded initial rows, current off-page focus/viewport, independent
overflow, draft continuity across all six themes and both modes, rendered normal
text/action contrast4.5, phone overflow, filter changes and reload. A distinct
authenticated user then saves MP. The original LP draft must get409, remain LP,
and leave the newer server review unchanged until explicit cancel loads MP.
All300 original files and299other candidate rows must remain identical; only the
intended peer review/revision may change. Each fixture cleanup compares every
field/count across all public tables. Native workers are absent.

The qualified reused4b5ffcimage binds493relevant original product inputs to
main3b06f208. The branch integrates main932e305c/whole-deck PR881. That delta changes
trade/deck code, settings and trade schema; it changes no reviewed Acquisition,
theme, auth or storage input. The exact changed-input comparison is retained
privately. The actual local fixture has84tables; this is no85-table or completely
rebuilt-image claim. Current-head CI uses the new schema. Required final-head CI
and independent review remain readiness gates, not substitutes for browser cases.

## Execution and preserved failures

Execution is in a new separately owned disposable application/database/network
with measured resource admission,640/384MiB web/PostgreSQL limits, oneCPU/no extra
swap and one browser worker. Actions have15-second bounds; each case has180seconds.
Existing review data, native workers and other owners are not used or changed.
All three final layout cases pass in50.7seconds. They exercise36theme/mode/layout
states, with both measured control contrasts at least4.5, actual peer conflict,
draft reload and zero Inventory/commit/audit. All300 original files/photo rows and
the299other complete candidate rows stay identical; only the explicit peer's
first-card review/revision advances. Every84-table full-row cleanup pair matches
its original baseline. Results, raw source binding, original/cleanup pairs and
terminal retirement are in `.local-data/p6-review-acceptance-20261023/`/the PR.

Initial fixture assertions incorrectly expected a saved-review overflow label on
an unreviewed card and exactly12rows after returning from the bottom, where the
normal sentinel could already load24. The unchanged focus/viewport and initial
bounded-page requirements remain. The phone then needed its ordinary initial
scroll to activate the lazy review action. Those failures/cleanup pairs remain;
they are not product failures or passing cases. The intermediate group passed
desktop but failed phone before its lazy action loaded; the final complete group
above passes all three widths without changing product source or deadlines.

## Phase completion and next safe step

Keep #308 open for its problem-specific filters and unresolved original
language/opener-default requirement. The merged deliveries above remove their
old review/merge waits; they do not erase these remaining software requirements.
Check recorded intent before a defaults change, and implement the agreed filter
work with current-head checks and affected desktop/phone workflow evidence.
Review required source/evidence limits instead of creating fresh broad
qualification work from every historical status sentence. The theme preference
UI, generic phone capture, every role/device, independent printing accuracy,
native sustained throughput and named-installation recovery are not newly passed.

Existing receiving criteria remain: #304 installed helper/stage provenance;
#307/#463/#749 independent recognition; #310 integrated scale/recovery/release;
#501/#565 installation acceptance; #442/#443 deferred other-provider/device work.
This map links those boundaries without moving their ownership or pretending
that partial phase delivery closes a tracker. No production/hardware action,
retention change, blanket retest or merge authority is created by this document.
