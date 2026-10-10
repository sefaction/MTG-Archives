# Scanner crop verification

This batch addresses #701, #702 and #705. The existing crop test assumed its diagnostic canvas was selected, pinned a historical visual-reference count, and treated completion of image comparison as proof that every suggestion was image-led.

The test explicitly selects Full card image initially and after both reloads. Its optional visual path independently validates the actual worker image's mounted complete generation in an offline, read-only descriptor container. The reconciled result must match both that generation's exact reference count and digest. Suggestion captions are checked against the authenticated, photo-bound review's actual selected suggestion reasons, including conservative whole-photo name hints. No application, recognition, ranking, sampling, retention or Inventory policy changes are included.

## Qualification and unresolved boundary

- Types pass. The descriptor independently validates the mounted generation; exact generation count/digest checks pass in the actual browser/native flow.
- The first two retained manifest scans (Sunblade Samurai and Island) pass the repaired initial view, exact suggestion-name and provenance checks in the latest actual visual run. This does not establish independent recognition accuracy: these are reused development originals.
- The complete three-scan run remains failing. The third scan, Thousand-Faced Shadow, reaches the unchanged footer-set assertion with an empty set-code list. An independent offline attempt using the actual recognition image and preserved SHA-verified original reads `086/302 R` and `NEOENEKATERinA BURMaK`. The footer parser intentionally does not infer a set/language marker from an unpunctuated artist join. Broader recognition issue #463 remains open; this batch does not relax its assertion or promote a parser heuristic.
- Since that assertion stops the run, this revision's post-reload desktop/phone painted-canvas screenshots, deliberate failed-visual-generation branch and final zero-Inventory assertion are not fully qualified. The PR stays draft pending full qualification.
- Earlier failures are retained: original missing-canvas precondition (#701), obsolete 112472 versus independently validated 112672 references (#702), and an image-led caption expected where the selected suggestion was an unlocalized name hint (#705).
- Assertion audit preserves all original guards other than the explicitly adapted exact generation count and exact source-dependent caption; footer and collector checks are unchanged.
- After the latest run, exact owned fixture cleanup, substantive other-owner correction projections, retained source-table projections, correction-file namespaces and fresh SHA checks of all 1092 retained originals (2832075218 bytes) pass. All 13 ordinary service images, lifecycles, mounts and limits are unchanged against the fresh October 10 baseline.
- Services had already restarted between the October 9 baseline and October 10 resumption. Their images/mounts/limits matched, but the older lifecycle conservation check failed. The cause is unknown; no attribution to this test or worker failure is made.

Private evidence is retained under `.local-data/crop-view-*` in the cumulative checkout. No private images, credentials or raw authenticated replies are committed. The batch depends on PR #700's guarded fixture cleanup. The cumulative local application still contains the nine earlier unapproved PRs; this batch changes tests only and requires no app rebuild.

Next safe step: qualify the unresolved footer behavior under #463 and rerun the full crop test before marking this PR ready. Meanwhile, independently address the user's open inventory sorting report #703. Each PR still needs individual human merge approval.
