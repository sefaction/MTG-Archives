# Faint stamp over printed footer text

Issue [#800](https://github.com/sefaction/MTG-Archives/issues/800) retains five
original/List suggestions that require further stamp discrimination. Reference
coverage is merged; uncertain stamp evidence must continue to require review.

The synthetic regression in `test_printing_evidence.py` adds a printed `W` to a
generated readable footer, then overlays a faint, displaced test symbol. The
reference printing itself has a weak stamp-template response. A proposed
reference-conditioned comparison incorrectly established absence by accepting
agreement around that ordinary printing while missing the overlapping mark.
The production detector correctly keeps the result uncertain.

This regression requires the altered source to remain outside the `ABSENT`
state and conserves both source and reference arrays. A future detector may
identify the symbol or retain uncertainty. Matching a known footer glyph alone
does not establish absence elsewhere in the observed search region.

The fixture contains only generated pixels and an existing generated test
symbol. No private scan, image, identifier or scan-derived measurement is
included. Production detector thresholds, registration, ranking, references,
model versions and manual/Inventory authority are unchanged.

This change protects one concrete counterexample; it does not repair the five
#800 cases, establish independent optical accuracy or complete #749. Those
issues retain their original acceptance criteria. The experimental detector
was rejected rather than incorporated into the product.
