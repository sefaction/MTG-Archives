# Batch dashboard query isolation

Issue: https://github.com/sefaction/MTG-Archives/issues/696

The dashboard deliberately searches batch-number substrings, locations, sections and owners. The lifecycle verifier previously searched for a number while treating the result as exactly one batch. A legitimate different match could make the post-Trash total nonzero or change the first row used for count checks.

The verifier now gives its target a unique section and uses that section for strict lifecycle assertions. Positive checks also assert exactly one matching row with the target's identity before reading its counts. Owner/admin denial, page clamping, cancellation, lease retirement, restored processing, current printing evaluation, seven-day retention, purge failure/retry and Inventory conservation remain covered.

Twenty-six empty test batches have sections equal to the target's number. The target must actually lie beyond the first 25-row page. The number search collects all pages before and after Trash, excluding the trashed target while preserving all 26 other identities and Draft states. Stable totals and no duplicate/missing rows are checked; unrelated legitimate matches remain allowed. Production search and lifecycle logic are unchanged.

The original PR695 acquisition CI failure returned one row where the old verifier expected zero, but did not record the matching row. Its same-head rerun passed. A prior unchanged-app owned counterexample and an isolated full-database baseline with one deliberate collision both demonstrate the missing query-isolation precondition. The latter fails the old post-Trash assertion with actual 1/expected 0 and cleans its disposable resources. This does not recover the original CI row identity.

## Qualification

The corrected full acquisition PostgreSQL suite passes in an isolated disposable database (113.9 seconds for the final multi-page case; the earlier single-collision pass is retained separately), including the deterministic collision and the existing lifecycle, ownership, concurrency, rollback, replay, lease and retention checks. Fixture rows, containers and network are cleaned. Local core verification passes 858 tests with zero failures/skips, final types, production build and all 13 client manifests. The final multi-page required-installer cumulative Docker build passes (208.0 seconds); the earlier single-collision 233.5-second build evidence is retained separately. Initial local harness image-tag, opt-in/storage guards and incorrect fixture section placement remain retained separately from the intended old-assertion failure.

Both existing actual API/browser dashboard workflows pass on the final image (20.9 seconds, zero failures/skips/retries; the earlier 17.9-second run is retained separately): physical-card counts, ownership, cancellation, Trash, restoration, stopped-scanner recovery metadata, and stale-last-page navigation. 1366px desktop and 320px phone screenshots were inspected with no horizontal overflow. These controlled fixtures do not operate a physical scanner or establish recognition accuracy.

The cumulative review app includes main plus separately unapproved PRs #684, #687, #688, #690, #693 and #695 and this batch. Web image `sha256:f475654e79cebc28e7f6baf5ee7a4333675992bec43055640313a8453b0b70b6` exactly matches all 595 inputs, digest `ca59b60adefbf4548c17c13b6c4aadc4504207ae6c696ba60317ca60a3aa75a1`. Only web was recreated. All 13 ordinary services are running with web healthy; the other 12 retain their images, start times, restarts, mounts and limits.

Existing native workers retain every one of their 308 original shared files. Against the new web bundle, their only difference is the unused `scripts/verify-acquisition-batch-management.ts`; the remaining 307 files match exactly. The only source import of this verifier is the database test suite. Production app/native entrypoints are unchanged, and native workers were not restarted for verifier-only packaging. This is an explicit one-file packaging difference, not a claim of complete new-bundle native parity.

Seven original table projections are conserved. Fresh before/after checks verify the identities, sizes and actual stored SHA-256 values of all 1,092 retained originals (2,832,075,218 bytes). All thirteen completed fixture namespaces and their correction/account records are absent. Final-head GitHub checks are collected separately before marking the PR ready; live results and the final revision are recorded in the PR and checkpoint. Private baseline/failure/final logs, JSON and screenshots remain in local `.local-data` folders. Issue #696 stays open until individual approval and merge.

Only the verification script and this document change. No recognition, production sampling/retention, user permissions, Inventory confirmation or physical scanner behavior changes.
