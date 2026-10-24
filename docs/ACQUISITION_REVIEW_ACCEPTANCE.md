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

## Requirement and evidence map

| Agreed requirement | Concrete source/evidence | Scope and remaining decision |
| --- | --- | --- |
| Persisted batch list, deep links and understandable progress | Batch dashboard/lifecycle UI and `ACQUISITION_BATCH_DASHBOARD.md`; actual browser lifecycle controls | Delivered software, distinct from every named installation or long-running native pipeline. |
| Saved printing, explained suggestions, local search and per-card attributes | `ACQUISITION_REVIEW.md`, `ACQUISITION_REVIEW_MODES.md`; `verify-acquisition-review.ts`, real-photo review steps | Existing source/database and recorded UI evidence; suggestions are not independent printing labels or accuracy percentages. |
| Batch finish/condition defaults, supported printing/language and overrides | Full PostgreSQL review verifier covers defaults/revisions, incompatible attributes and overrides; automatic-confirmation report | Known defaults may automatically confirm only the existing strong-match boundary. UNKNOWN finish cannot silently commit; opener stays explicitly unknown for scan receipts. |
| Human correction survives count, refill, reload and explicit commit | Merged #839 and `COUNTED_REVIEW_PRESERVATION_QUALIFICATION.md` | Actual persisted and compiled desktop/phone chain. Its earlier failure and historical one-copy repair remain distinct; it does not authorize other Inventory repairs. |
| Separate ready, pending, uncertain and overflow physical totals | `acquisition-review-display.ts`, full store/commit verifiers, draft-actions UI; this300-card fixture has298ready/two pending with independent uncertainty/overflow | Controlled persisted evidence. A saved review does not erase uncertainty or free a physical slot. Unreviewed overflow first asks for printing; progress still reports OVERFLOW. |
| All/Awaiting/Ready/Added filters and stable physical order | Review modes and `SCAN_REVIEW_NAVIGATION.md`; merged candidate ordering #902; current controlled300-card filter/navigation case | Counts cover the full batch. Filtering starts a bounded page; normal sentinel loading can extend it. Intentional off-page navigation may reveal the requested later row. |
| Bounded hundreds-card review and retained source bytes | Existing100/300 presentation qualification recorded with paged-review cleanup; new300-card fixture exercises current controls | Presentation is separate from failed/unqualified native100/300 throughput and150000-copy integrated release criteria in #310. |
| Draft survival across modes, filters and reload | Browser-draft/status/action-guard reports and tests; new Simple/Advanced/six-theme/current300-card case | Browser storage is not cross-device authority. Save/cancel is explicit; unreadable/quota failures retain the existing guard behavior. |
| Competing edits are visibly refused without losing a newer draft | Full PostgreSQL review/history rollback controls; new actual second-user MP save followed by stale LP browser refusal and explicit cancel/reload | Same-player second user exercises a real separate actor, route/session/revision. It is not every owner/Admin Mode UI permutation; existing database tests retain their separate history/rollback evidence. |
| Retry and interrupted-response behavior | `ACQUISITION_BULK_RECOVERY.md`, draft-action/status tests and recorded real API response-loss controls | Frozen original payload/retry identities and existing server replay/conflict fences. Do not rerun unchanged transport positives merely because another PR waits. |
| Owner/Admin Mode and private originals/history | Review service authorization, private file routes and existing PostgreSQL/real-photo/fast-correction controls | Preserve intentional private/admin differences. Current reviewer acceptance does not establish every installed role/session combination; private restore is separately tracked. |
| Missing worker, no match, empty alternatives and incomplete evidence | Processing-recovery/report controls; existing empty-search navigation checks; this fixture has no native workers and retains pending/corrected source | Controlled failure states, not diagnosis of historical worker exits or recognition success. Empty search cannot remove the saved printing/draft. |
| Stop, count uncertainty, refill and optional ordered-section acknowledgement | `SCANNER_SECTION_SERIES.md`, counted-feed and review-preservation reports; simulated protocol/browser and real PostgreSQL controls | Explicit next section/Start/refill and persistent Stop; no automatic feed or stock. Preserve original failed physical boundaries. Ordinary accepted operation is not complete helper/provenance/scale acceptance. |
| Other-session warnings and fresh destination revisions | Full store verifier checks pending3/stale destination; counted capacity API/picker and section-series UI checks held-space warnings/fresh section choice | Existing actual source/database/protocol UI evidence. Do not substitute generic phone reservations for counted fi-7160 semantics or treat advisory capacity as a global stock limit. |
| Selected subset, five pending, reassignment choice and fresh overfill | Ready PR927 / `ACQUISITION_CAPACITY_HANDOFF.md`, existing commit/receipt tests |263-to258 browser controls are review-ready, not merged. Alternative five-card destination is previewed only; later addition there remains outside that evidence. |
| Keyboard/Escape and successful save/discard focus | Real-photo review keyboard steps and merged PR917/919 qualification reports | Scoped Simple/Advanced1366/320 controls, outside-focus preservation and failed drafts. No blanket browser/assistive-technology certification. |
| Desktop1366x768, phone390/320 and all six themes | Current opt-in `acquisition-review-acceptance.spec.ts`:300 controlled cards, both modes, all `APP_THEMES`, real draft/conflict actions | New execution results/source binding are recorded below and in the PR. Theme switching here changes DOM theme only; persisted preference saving has separate tests. |
| Review, preview, refresh and navigation never create Inventory | All existing review/commit separation controls; new case requires zero stock/commit/audit and stable originals/candidates except one explicit peer review | Only the separate explicit final commit may add stock. PR925/927 remain individually review/merge gated. |

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

Keep #308 open until applicable ready changes are individually approved/merged
and each remaining criterion above has accepted evidence or an explicit visible
transfer. Review required source/evidence limits instead of creating fresh broad
qualification work from every historical status sentence. The theme preference
UI, generic phone capture, every role/device, independent printing accuracy,
native sustained throughput and named-installation recovery are not newly passed.

Existing receiving criteria remain: #304 installed helper/stage provenance;
#307/#463/#749 independent recognition; #310 integrated scale/recovery/release;
#501/#565 installation acceptance; #442/#443 deferred other-provider/device work.
This map links those boundaries without moving their ownership or pretending
that partial phase delivery closes a tracker. No production/hardware action,
retention change, blanket retest or merge authority is created by this document.
