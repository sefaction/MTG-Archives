# Intake fixture workflow and cleanup failures

Related to existing [#692](https://github.com/sefaction/MTG-Archives/issues/692)
and parent [#310](https://github.com/sefaction/MTG-Archives/issues/310).

Four actual fixture teardowns could replace an original browser/native assertion
with a cleanup-only aggregate: photo-intake, upload-recovery, library-batch and
successive-batches. The bounded source negative on main `a2bba926` executes each
real catch/finally around an injected workflow failure. It reports 43 failures
and 51 passes: independent/simultaneous cleanup failures erase the workflow cause,
while healthy cleanup and cleanup-only controls already pass. These four paths
are separate from PR #973's processing-recovery, quick-finish and stamp-visibility
reporting repair.

Each fixture now records the original thrown value, rethrows it normally, and
prepends it only when cleanup itself must throw an aggregate. Undefined, null,
false, zero and empty-string throws remain observable. Cleanup-only errors get
no invented workflow cause. Cleanup order, cancellation and lease-drain guards,
file-before-relational cleanup, final feedback sweeps and all existing actions
are unchanged.

Verification on the repair:

- All 94 actual catch/finally controls pass, including each cleanup failure,
  ordered simultaneous failures, falsy workflow throws and exact original error
  identity after healthy cleanup. Successive-batches still forbids deletion after
  cancellation or lease-drain failure and still attempts the final feedback sweep.
- The focused group passes 231 controls with zero failures or skips: the 94
  workflow controls, nine photo-intake file/recovery controls and 128 remaining
  fixture-file controls. Calls to browser/database/filesystem operations are
  controlled adapters, not real destructive fixtures.
- A Git/TypeScript AST comparison confirms all 132 original expect calls, 45
  template literals and four deadlines are unchanged. Removing only the declared
  workflow accumulator, catch/rethrow and aggregate operands restores every other
  fixture byte after CRLF normalization, including the original EOF shape.
- Required exact-head CI and independent review are recorded on the PR. No
  application source, dependencies, schema or runtime stack changes; no local
  application rebuild or repeated desktop/phone/native workflow is needed for
  this error-reporting repair.

The first private preservation script failed on its own TypeScript import path;
the corrected script then identified an incidental EOF newline introduced while
editing. The original EOF was restored before its final successful comparison.
These were validation-harness/source-preservation refusals, not fixture passes.
The original 43 failing controls remain retained separately.

This does not qualify ordinary optical/browser/native behavior, real SQL/file
conservation, historical incident causes or release-wide acceptance. Broad
#692/#310 remain open. No new issue was created under Brian's current freeze.
Individual PR approval and an explicit merge request remain required.
