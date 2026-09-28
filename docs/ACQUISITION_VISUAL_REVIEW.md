# Visual batch review

Tracking: #308, with recognition troubleshooting under #463.

The user requested scan/printing comparison without opening a dialog for every card, image-based alternatives, and explicit recognition gaps. Saved cards now append twelve at a time as the list reaches the viewport; Load more remains a keyboard/manual fallback. Each row keeps its position in the physical batch. Original scans and printing references appear side by side at desktop and phone widths. Alternative printings and manual search results use selectable image thumbnails, set/collector captions and selected-state text. Selection is provisional until Save card review; Inventory still requires a separate explicit confirmation.

## Evidence and inspection

The owner-authorized review response includes a bounded projection of stored native geometry, both reading directions, grouped title/footer text and OCR polygons. Model descriptors, paths and private runtime internals are excluded. Stored evidence survives a review revision; it describes the immutable photo and does not overwrite a human decision.

- Original: EXIF-normalized browser display with the worker's saved outline.
- Detected card: a display-resolution reconstruction of the saved perspective transform and selected reading direction. It is not a new detection pass or the exact native inference bitmap. Browser sampling can differ from OpenCV; originals are unchanged.
- Reading zones: the attempted top 250 and bottom 187 rows of the 1000x1397 native crop, plus saved OCR text boxes. A box means text was detected, not that it was correctly understood.
- Unknown direction: inspect either direction explicitly; no fabricated upright claim or cross-direction text combination.
- No outline: show the original and explain that OCR could not begin.
- Name, set, collector and language: observed text/parsed identifiers with read, ambiguous or differing-from-selection states. Missing fields remain visible.
- Planeswalker stamp, set symbol and artwork: explicitly not checked. The current runtime has no visual detector for these features. Existing List ambiguity warnings remain visible.

The reconstruction is transient browser memory. Full-photo loads, sampling and review polling are limited to nearby rows; canvas buffers are released outside the viewport. Source sampling is capped at a 2400-pixel longest side and output at 400x559. Catalog thumbnails load lazily. Unsaved editor state remains attached to the row while scrolling, and background refresh does not overwrite it. Concurrent saved revisions continue to reject stale writes with Reload review.

## Scope limits

This batch changes review and diagnostics, not recognition ranking or automatic-confirmation thresholds. External catalog fallback, visual retrieval, stamp recognition and improved localization remain under #463. Search still uses the installation catalog and says so. No database migration, new persisted image, model download, Unraid environment or Compose change is needed.

## Checks

Pure tests cover evidence bounds/privacy, absent geometry and corner mapping. The disposable acquisition/database helper covers saved-review ownership, revisions and receipt integrity. Browser acceptance uses the existing owned local fixture, real rotated Android photos, manual/automatic corrections, explicit duplicate-safe commit, phone widths and progressive list loading. Results and current source/image identifiers are recorded in WORK_CHECKPOINT.md and the PR.
