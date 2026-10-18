# Scanner footer row pairing qualification

Related to [#838](https://github.com/sefaction/MTG-Archives/issues/838), [draft #847](https://github.com/sefaction/MTG-Archives/pull/847). October 18, 2026.

## Result and boundary

Source commit 263c9a1aa3aeb62374079578b55683dd56f8d65c, based on merged main a724f54ae9c6f583a0fb243afe27d50c513a097a. The prior capped-scanner admission fix #845 remains included. This batch changes interpretation of already available positioned footer text: adjacent collector and set/language rows may overlap at their glyph-box edges if each row's center lies outside the other box. The legacy small-overlap branch stays intact. Existing source schema, footer region, character interpretation, conflicting-identifier veto, horizontal alignment and maximum row distance are unchanged.

Only three application files change: acquisition-scanner-source-text.ts plus the text and catalog interpretation versions. Text resolver is scanner-source-row-pairing-v16 and catalog resolver is catalog-reconciliation-row-pairing-v15. The actual old and new Linux raw-recognition version functions return the same identity for an equal model, including when the catalog changes. The raw worker, capped-scanner-footer-v2 admission, native implementation, model, resource and deadline policies remain byte-equivalent to the baseline.

Supported footer suggestions remain REVIEW_REQUIRED with automaticAcceptance false. No automatic Inventory creation or historical record repair is introduced.

## Evidence

- Four new unit tests cover distinct-center overlap, legacy positives, same/reversed/nested/central overlap, absent/blurred/conflicting/shifted/distant identifiers, OCR-only and combined proposals, directional title support and immutable raw input. All 384 acquisition tests and final typecheck pass.
- A frozen comparison of 7,200 bounded geometry/identifier cases yields 360 old positives, 402 current positives and 42 additional valid cases. No prior-positive regression, invalid/conflicting new support or input mutation occurs. These synthetic cases are not an accuracy estimate.
- Two retained development whole-photo observations are compared without rerunning native OCR. Old interpretation supports Island 385 but rejects Cruel Calculations 336; current interpretation supports both. The actual old Linux image reproduces the expected second failure. All four current Linux images accept both and pass 51 focused tests each, 204 aggregate.
- The retained observations are reused development evidence, not independent data or reproduction of the exact historical full-catalog/model generation. The natural current Cruel catalog already happens to put 336 first; the regression therefore uses a deliberate wrong-first ordering to prove the supported-source ordering rule.
- An owned disposable PostgreSQL and compiled Chromium fixture starts with only wrong printing 26 cached. A completed raw attempt supplies controlled saved positioned footer observations. A completed old-version catalog result is preserved; current-version enqueue admits exactly one replacement and duplicate enqueue admits none. No new raw job is created. Actual catalog claim, cache/provider import, handler and completion recover missing printing 336, publish it first with source support and current interpretation versions, while raw output and candidate state before manual review remain unchanged.
- The browser observes the updated alternatives without a page reload. A deliberate printing 26 / lightly played override survives save and phone reload; Inventory stays empty. Whole selected tiles and no horizontal overflow are verified at 1366 and 320 pixels; the phone screenshot is visually inspected. Fixture image, OCR delivery and provider are synthetic; this is not new native inference or normal uncapped-title admission.

## Cumulative local review

Application cumulative commit d1a93af26cffe259fdc9edd39b22137318623dea. Review remains at http://127.0.0.1:13011. All six intended roles have actual source, platform image, environment, mounts, settings and generation proofs; 17 other container identities/settings/lifetimes and primary native event counters are conserved. Each actual image binds 627 manifest inputs and checks 333 library/script byte hashes. Web compilation was rebuilt. Native base layers/configurations and the four established native/web source differences remain intact.

Tracked feature/cumulative differences are checked by exact Git blobs and LF-normalized text where Windows line endings differ. Two generated installers retained only in the cumulative tree are separately hash-bound. The three additional builder inputs omitted from the existing manifest remain separately hash-bound; the known completeness gap #842 is not repaired by this batch.

Paired originals/correction/catalog/review records and the visual index remain unchanged. The 47.888-second idle/refresh check is brief continuity evidence, not sustained load qualification or an explanation of prior #777 and other failed runtime intervals. HostConfig comparisons allow only previously established empty-DNS representation and bounded bind ordering that reconstruct the exact baseline hash; a one-byte memory change still fails the check. Normal runtime resources and capabilities are unchanged.

## Retained failures and remaining work

The first frozen-comparison harness omitted the TypeScript loader and failed module resolution. The first isolated Linux probe omitted writable /tmp for the loader cache and failed before assertions. Both initial failures are retained privately, corrected with the existing loader/bounded temporary-filesystem conventions, and rerun successfully. No product failure or deployment rollback is inferred from those fixture errors.

This does not repair the normal primary-only, uncapped Cruel fallback-admission case: source text must already be available. Spaced or ambiguous collectors, three unavailable originals, complete archived generation replay, independent printing discrimination and sustained hardware acceptance remain open. No five-case historical recovery, production deployment, merge or issue closure is claimed. The 64 decimal GB per-owner correction limit and 2% random controls remain unchanged.

Private qualification records are in .local-data/row-pairing-qualification. Exact final report/browser commit, required CI and cumulative image identities are recorded on #847 and in the work checkpoint. The separate reviewer owns readiness, individual human approval, merge and final issue disposition.
