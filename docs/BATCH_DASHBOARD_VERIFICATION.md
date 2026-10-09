# Batch dashboard query isolation

Issue: https://github.com/sefaction/MTG-Archives/issues/696

The dashboard deliberately searches batch-number substrings, locations, sections and owners. The lifecycle verifier previously searched for a number while treating the result as exactly one batch. A legitimate different match could make the post-Trash total nonzero or change the first row used for count checks.

The verifier now gives its target a unique section and uses that section for strict lifecycle assertions. Positive checks also assert exactly one matching row with the target's identity before reading its counts. Owner/admin denial, page clamping, cancellation, lease retirement, restored processing, current printing evaluation, seven-day retention, purge failure/retry and Inventory conservation remain covered.

A deliberate second batch has a section equal to the target's number. The number search must include both before Trash, then exclude the trashed target while preserving the other batch in Draft. Matching identities are collected across every result page, with stable totals and no duplicate/missing rows; unrelated legitimate matches remain allowed. Production search and lifecycle logic are unchanged.

The original PR695 acquisition CI failure returned one row where the old verifier expected zero, but did not record the matching row. Its same-head rerun passed. A prior unchanged-app owned counterexample and an isolated full-database baseline with the deliberate collision both demonstrate the missing query-isolation precondition. The latter fails the old post-Trash assertion with actual1/expected0 and cleans its disposable resources. This does not recover the original CI row identity.

Final qualification is pending. Initial local harness image-tag, opt-in/storage guards and incorrect fixture section placement were retained separately from the intended assertion failure. The final type check passes. The corrected full acquisition database suite, core/build, cumulative local Docker/source/runtime/data conservation and final-head GitHub checks will be recorded after execution.

Only the verification script and this document change. No recognition, production sampling/retention, user permissions, Inventory confirmation or physical scanner behavior changes.
