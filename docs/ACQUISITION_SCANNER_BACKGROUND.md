# Conservative card-scan background preparation

Issue #543. CARD_SCAN represents one already framed card. Preparation must not
run the PHOTO contour ranking that previously chose the inner printed frame and
lost the identifier strip. Reading zones remain title 0–250 and footer 1270–1397.
Original artifacts, byte digests and explicit review/Inventory authority remain.

A derived scanner proposal may remove an outer bright band only when it spans at
least 98% of each row/column, occupies 2–8% of that edge's dimension, and meets a
continuous dark border covering at least 90% of the seam. An opposite bright edge
is ambiguous (including white card borders). Keep one background pixel outside
the border, retain at least 86% of the source area and a plausible card aspect.
Otherwise retain all four source corners. No internal-contour search, dark/gray
background removal, new reading zone, physical scanner setting or retry is added.

The saved `scanner-background-trim` method and original-space quad reconstruct
Prepared card and Reading zones in review. Original still opens the retained
artifact. Existing declared/full-frame evidence remains supported. Recognition
and visual descriptors include the geometry source digest, identifying the new
preparation generation; printing's independent reference registration is intact.

Offline baseline on the retained centered PS286 original: the full 1560×2160
frame yielded no footer text. Removing only 118 bottom rows (5.46% of height),
retaining row 2041 as the one-pixel guard, yielded `039/302 C` and `NEO·EN` in the
unchanged footer zone. All original bytes and the physical black border remain.
This is a development fixture, not a universal scanner qualification. Missing
pixels in an already clipped original (#539) and driver failures (#542) remain
separate issues. Broad or unclear backgrounds deliberately retain the full scan.

Qualification results and local review provenance are recorded in WORK_CHECKPOINT
and the PR. Private originals, OCR output and browser images remain uncommitted.
## Validation

- Eight synthetic geometry guards cover quarter-turns, the physical border/footer,
  thin and white borders, blank images, ambiguous seams, broad padding, source
  immutability and PHOTO separation. Twelve reading-direction/input guards and
  eighteen independent printing/runtime/cache guards pass (38 total).
- Hash-verified corpus: 107 prior scanner originals (17 early + 90 later) × four
  rotations have identical prepared pixels/evidence to main: 428/428 unchanged.
  The 28 additional phone originals × four rotations are also unchanged: 112/112.
- Cumulative TypeScript typecheck and all 753 unit checks pass. Docker production
  build and client manifests pass. Loaded native workers match the new geometry
  source SHA-256 `5590b119fbe4acb3a61e56ffcf29b2e9c33c4a3bdf7b10fccad6c6a0b87ebde5`.
- Real local browser regression uses retained padded and blank originals through
  ordinary recognition/visual/printing queues; see PR/checkpoint for the final
  result and desktop/phone review. No model download or physical scan is needed.
