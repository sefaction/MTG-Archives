# Fixture workflow and cleanup failures

Related to existing [#692](https://github.com/sefaction/MTG-Archives/issues/692)
and parent [#310](https://github.com/sefaction/MTG-Archives/issues/310).

Fifteen actual outer cleanup paths in fourteen fixtures could replace an original
browser/native assertion with a cleanup-only aggregate. The finite original #692
check covers photo-intake, upload-recovery, library-batch, successive-batches,
batch-dashboard (two cases), scan-retention, footer-identifiers, printing,
scanner-framing, photo-text, photo-text-streaming, stamp-expectations, large-batch
and live-recovery.

Actual-source negatives execute each real catch/finally around a controlled
workflow failure. The initial four intake paths on main `a2bba926` report 43
failures and 51 passes. The eleven remaining paths independently report 77
failures and 153 passes. Independent/simultaneous cleanup failures erase the
workflow cause; healthy cleanup and cleanup-only controls already pass. Separate
PR #973 covers processing-recovery, quick-finish and stamp-visibility; PR #971
retains scanner-crop. Their source scopes are excluded here.

Each fixture now records the original thrown value, rethrows it normally, and
prepends it only when cleanup itself must throw an aggregate. Undefined, null,
false, zero and empty-string throws remain observable. Cleanup-only errors get
no invented workflow cause. Cleanup order, cancellation and lease-drain guards,
file-before-relational cleanup, final feedback sweeps and all existing actions
are unchanged.

Verification on the repair:

- All 324 actual catch/finally and cleanup controls pass, including each cleanup failure,
  ordered simultaneous failures, falsy workflow throws and exact original error
  identity after healthy cleanup. Successive-batches still forbids deletion after
  cancellation or lease-drain failure and still attempts the final feedback sweep.
- The focused group passes 461 controls with zero failures or skips: the 324
  workflow/cleanup controls, nine photo-intake file/recovery controls and 128 remaining
  fixture-file controls. Calls to browser/database/filesystem operations are
  controlled adapters, not real destructive fixtures.
- A Git/TypeScript AST comparison confirms all 517 original expect calls, 196
  template literals and fifteen deadlines are unchanged. Removing only the declared
  workflow accumulator, catch/rethrow and aggregate operands restores every other
  fixture byte after CRLF normalization, including the original EOF shape.
- Required exact-head CI and independent review are recorded on the PR. No
  application source, dependencies, schema or runtime stack changes; no local
  application rebuild or repeated desktop/phone/native workflow is needed for
  this error-reporting repair.
- A separate83-control composition check passes with the actual three #973
  fixtures at `c950a1b8`, including its workflow controls and this revised stamp
  adapter/helper. This is selected-source adapter compatibility, not a full
  merged-tree or application-runtime qualification.

The first four-fixture revision `d3e9895e` passed all nine exact-head CI jobs in
Verify40115097532 (actual Core1,907 passes/one existing platform skip, full types,
production build/client and27 guideline controls). That evidence covers only that
earlier scope; the expanded final head requires its own current-head CI/review.

The first private preservation script failed on its own TypeScript import path;
the corrected script then identified an incidental EOF newline introduced while
editing. The original EOF was restored before its final successful comparison.
These were validation-harness/source-preservation refusals, not fixture passes.
The original 43 and later77 failing controls remain retained separately.

This does not qualify ordinary optical/browser/native behavior, real SQL/file
conservation, historical incident causes or release-wide acceptance. Broad
#692/#310 remain open. No new issue was created under Brian's current freeze.
Individual PR approval and an explicit merge request remain required.
