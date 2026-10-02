# Restored import choices

Imports now offers **Scan cards**, **Camera**, and **Upload photos**, alongside CSV, manual addition, export and history. Camera and Upload photos share the existing private, destination-aware image batch workflow. Starting these routes requires no scanner setup; camera access still begins with the explicit Open camera action. Both photo controls remain available in the batch.

The selected photo entry point survives batch creation, refresh and New batch. Explicit photo routes leave a saved scanner-start intent intact for the scanner route and issue no scanner-run requests. Existing legacy `/imports/scan` behavior, recognition/review, capacity, owner authorization and explicit Inventory confirmation remain in place.

## Evidence

- Baseline on approved main b57a572: Camera link absent; bounded navigation regression failed at that missing entry point. Initial baseline timeout cleanup issue was corrected; original evidence is retained locally.
- All 773 unit tests and TypeScript checks pass. Installer-required Docker build passes, including lint/type validation, production build and all ten client manifests. Bundled verified scanner installer 0.3.8 retained.
- Six affected browser cases passed: desktop and 390/320px phone navigation; streamed library uploads/capacity/parallel bounds; fake-camera capture/lost ACK/retake/privacy; both scanner START recovery cases; CSV review/commit/history/owner boundaries. After the final photo capacity wording refinement, camera and desktop/phone saved-intent checks pass. The New batch assertion was moved from the later legacy-route batch to the actual Upload photos batch; its final focused rerun is recorded below.
- Visual screenshots inspected at phone widths. Real camera/device acceptance remains the existing separate hardware gate; the browser camera fixture is simulated.

## Local review

Review at http://127.0.0.1:13001/imports. Branch `codex/import-input-methods` is based on approved main b57a572. Only web is replaced, with image `mtg-archives-web:import-input-methods` (sha256:99abe0a46f4651824111bd056b96ac2926074a5f898aa4d58d1a83041476d93f). Existing acquisition/native, pricing and notification workers and their data/mounts remain. Compose layer: primary `.local-data/import-input-methods-review.yml`.

Final loaded application manifest: 513 files, digest d2dc1ae097dec6f301934797cc84eabd429475b7a4b688e4cb985eddce2d56fa. Existing unrelated primary/managed WIP remains untouched. No scanner feeding, production update or merge occurred. Issue #583 remains open until this PR is individually approved and merged.

Retained intermediate failures: the first final-image browser attempt reached /login before startup (ERR_EMPTY_RESPONSE); after a host HTTP 200 check, camera/navigation passed. The added New batch assertion initially targeted the later legacy /imports/scan batch, whose unchanged default URL is expected. That test placement was corrected. Earlier failures and traces remain under ignored .local-data and were not overwritten.

Final results: photo-intake and expanded navigation/saved-start checks passed on the final source; corrected library/New batch case passed (20.8s). Typecheck is clean. Inventory remains 10,280 rows / 12,482 copies; all 907 photo records and 81 saved reviews remain. The filtered original inventory/photo identity hashes match the pre-check snapshot. Disposable fixtures from this batch are removed; the prior retained acquisition fixture remains outside this batch.
