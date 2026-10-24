# Review problem filters (#308)

The Scan cards review workspace keeps All, Pending, Ready to preview and Added
to Inventory. **Show cards → Review problems** also selects these original P6
categories:

| Filter | What it shows |
| --- | --- |
| Conflicting suggestions | A completed current result has conflicting available printing suggestions and no printing has been saved. |
| No match | Completed current evidence has no available local printing suggestion, without an unfinished or failed current check. Waiting for recognition is different from no match. |
| Choose finish | The saved finish is unknown, or the batch default cannot resolve a supported finish for the current proposed printing. The existing single-finish/default policy is reused. |
| Photo needs attention | The current source evidence reports clipped framing or a needed crop. A saved printing does not repair those pixels. |
| Outside batch allocation | The existing physical-readiness calculation reports overflow; printing review does not free the physical copy. |

Counts cover the whole batch and can overlap. A photo may need both a crop and
a finish choice. Added or excluded copies do not acquire new problem flags.
Rows retain physical order and the existing bounded page/load-more behavior.

Unsaved corrections remain visible even when they do not match the selected
filter, so more rows can be visible than its matching count. Changing a filter
or mode does not save or cancel an edit. The existing browser draft recovery
applies after reload; problem counts describe saved state/current evidence rather
than pretending that an unsaved edit is a server decision.

Selecting any filter performs no review or Inventory write. Existing human
review, physical readiness and fresh explicit commit checks retain authority;
a quality filter does not introduce a new automatic rejection or condition
grade. Incomplete supplemental work does not manufacture a no-match result.
An earlier failed job also cannot obscure a newer completed check indefinitely.

## Source and privacy boundary

The existing progress service performs live actor/owner/Admin Mode checks before
reading problem metadata. Its added query is scoped to that run's current ready,
unpurged photo generation and exact digest/manual-analysis instruction. It uses
the same newest-16 job selection and printing/catalogue pairing as card review.
The source-selection extraction preserves the existing recognition DTO behavior.

The database projects small status, geometry and proposal-identity fields; it
does not return full recognition/native outputs. Current local printing records
supply availability and supported finishes. Only the resulting five problem
codes are added to each progress slot, without OCR text, private image bytes,
worker/model paths or descriptors. Historical, wrong-byte and old repair inputs
cannot supply a current problem flag.

The quality view uses existing crop/framing evidence, not a newly calibrated
blur/optical/printing-accuracy measurement. Catalogue/model inference, automatic
confirmation, scan admission, schema, language/opener defaults and retention
policy are unchanged. Related #308 remains open for remaining original scope;
the separate reconciliation PR #952 and broader receiving trackers retain their
own approval, delivery and acceptance boundaries.

## Verification

Focused classification/display/source-selection tests and lint are recorded on
the resolving PR. The acquisition SQL suite runs the actual progress/projection
regression on its existing disposable review fixture, including pending/malformed
results, wrong digest/generation/manual intent, private projection, foreign-owner
denial and full public-table conservation.

The opt-in `acquisition-review-problems.spec.ts` uses the existing guarded review
fixture: one real authenticated upload/review and 299 explicit persisted copies.
Controlled saved jobs qualify metadata/UI behavior, not recognition inference or
300 provider acknowledgements. It checks whole-batch overlapping counts, stable
paging, dirty-row visibility, reload, modes/themes, background completion, exact
original/candidate preservation and zero Inventory effects at desktop/phone
widths. Each cleanup compares all original public-table fingerprints. Actual
execution, source/runtime bindings, failures, terminal cleanup, exact-head CI and
independent review must be recorded before readiness; source alone is not a pass.
