# Terminal scan processing recovery

The compact per-card status used only selected-printing/printing-stage/catalog
branches. A failed main identification or completed NO_MATCH result with no selected
printing fell through to Waiting for identification. The same scan could therefore
look indefinitely queued after automatic work had ended.

This batch gives Simple and Advanced review a shared stage-aware progress message,
explicit failed/no-match guidance, and Find printing manually, opening the existing
correction search with keyboard focus. Genuine queued/running stages retain their
own progress. A saved human or automatic review always takes precedence; the
recovery action is absent for saved/committed cards. Searching, polling and opening
the editor do not save a review or create Inventory. Explicit Save and explicit
Inventory confirmation retain their existing revision/receipt protections.

#570 is the focused defect; #506 is the broader workflow and #560 retains separate
source reproducibility under PR #569. Legacy AcquisitionPhotoRecognition has no
current callers; its early-stop code is excluded and is not claimed as a live defect.
Current AcquisitionPhotoReview already polls active supplemental stages. This
batch verifies those in-place updates alongside dirty drafts; it does not change
worker admission, retries, model thresholds, scanner execution or Inventory logic.

## Evidence

The unchanged local baseline failed the original 10-second compact-status assertion:
FAILED was displayed as Waiting for identification. It is retained in ignored
`.local-data/night-processing-baseline.log` and baseline artifacts. A later pass is
only valid after the source fix; it is not an isolated retry of unchanged code.

Core verification passed764units, typecheck, host production build and manifest
guards. Final764units passed after distinguishing failed catalog reconciliation
from generic identification failure. Docker with the required verified scanner
installer built successfully. The loaded cumulative web image is
ddc6fcaffa2bed2c5599484678d679af71a7598dd39b07bdf860da57bb8c8b7b;
509explicit web inputs match source digest
63e1925e150ff1447e06295b191a343e20214b661654bf9c939cf6bac2733a49.
Host login returns200. Existing qualified native OCR/visual and printing images,
original model/index mounts and all prior Compose layers are retained.

Owned desktop1366/phone390 fixtures exercise text/image/printing failures, completed
no-match, late supplemental failure, focused manual search, real saved correction,
dirty-draft refresh and saved review precedence. They assert exact original hashes,
zero Inventory, no horizontal overflow and owned cleanup. Controlled UI states are
not proof of native inference accuracy, hardware recovery or production behavior.
Final browser outcomes and the24saved-scan actual worker-crash qualification belong
in the overnight handoff. No production access, scanner feed or merge was performed.

Initial implementation transport produced an encoding/test expectation error and
then a nullable loading-state type error. Both were corrected before final builds;
the failed attempts remain in the private logs. These are not runtime regressions
being hidden by a later isolated retry.

The first final browser group recorded4passes/2failures: both new recovery fixtures
reached the correct failure labels but transformed the real search array because
the test route matcher was overly broad. Trace identified `map is not a function`;
the matcher is now limited to photoId review reads and real manual search remains
unmocked. Failed desktop/phone artifacts are retained. Closed-browser cleanup also
prevented two owned fixtures from being removed; both were verified zero-stock,
then removed with their temporary sessions/files. Corrected full group acceptance
is required before this batch is considered ready; no isolated retry is a fix.

The corrected desktop recovery case now passes (23.5sec); final grouped outcomes are recorded after the phone and existing quick-finish checks finish.


Final corrected full affected group:6/6PASS, zero skips,2.5minutes. Desktop1366/phone390 manual-recovery cases pass with original hashes and zero Inventory; existing drafts, fast corrections and quick finishes also pass. Failed runs remain separate evidence.
