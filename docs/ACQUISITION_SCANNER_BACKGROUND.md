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
