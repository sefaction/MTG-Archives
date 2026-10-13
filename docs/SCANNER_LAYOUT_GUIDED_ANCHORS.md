# Saved-placement anchor searches

Issue #764 exposed a fixed scanner layout whose collector fell above the generic whole-image footer strip. A manual calibrated1400x1955 card at[100,200] in a1600x2300 image had valid saved anchors, but the next same-layout scan could not infer its outline because the collector was never searched.

When ordinary anchors are unavailable/ambiguous, this batch uses the frozen saved placement for a separate bounded title/footer/source-identifier search. It starts only before12seconds. Measured/manual/known-clipped geometry, unsupported frame/policy and incomplete calibration retain precedence. Both current title and collector positions must corroborate any guided inference; the stored placement alone supplies no physical boundary or printing identity. The calibrated card size, translation/anchor-disagreement/inbounds guards remain unchanged.

Search observations and their original-frame region remain separate from primary and final inferred readings. Native/application validation ties the search to the exact frozen placement, directions and actual source windows; inferred offsets must reconstruct from those current guide-space observations. Search-only or rejected geometry does not contribute printing proposals. Later reference refinement retains the separate search evidence. Advanced review labels its uncertain search placement. Optional search failure/late-start and evidence exhaustion preserve successful primary observations.

## Qualification checkpoint

Actual offline PP-OCR recovers the previously failing padded target, reading Another Creature/U0042/TSTEN with2.067pixel maximum analytic corner error. Actual search-source/current-anchor binding and exact previous primary source digest/geometry/words/boxes/directions/zones pass. These are known-position synthetic pixels, not independent physical-card accuracy.

Full disposable PostgreSQL acquisition/import integrity, application types/tests/build and41 native photo guards pass. Independent guards reject changed placement, missing/contradictory/unreadable anchors, source substitution/foreign frames, unsupported/incomplete calibration and physical clipping. Optional failure and12-second late-start preserve completed primary observations. Reproducible generator --padded and separate opt-in browser cases cover the existing tight layout and larger-margin layout.

Docker build/loading, actual tight/padded native/browser desktop/phone save/use/reset, final resource/source/cleanup checks and PR publication are pending at this checkpoint. No larger-envelope or99% exact-printing claim, hardware operation, production deployment or merge authorization is created.
