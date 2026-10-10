# Inventory sorting investigation (#703)

The report's screenshot was inspected in the browser. It shows Public inventory with Equipment, League 2026 and three owner filters. Issue #704's closed drawer-filter question is separate and its intentional broader detail context is preserved.

## Current evidence

No application source has been changed. The local cumulative Docker application's Inventory/Public implementation matches current main; its additional unapproved batches affect acquisition workflows.

The new owned browser fixtures compare direct sorted API replies, direct page URLs and header clicks in exact/grouped Inventory and Public views. A separate 12-card, three-owner fixture retains Equipment/League 2026/owner filters, checks aggregate quantities, both server pages, reverse sorting and phone reload. Only exact created owners/cards are removed in teardown.

The initial grouped-view failure was a verifier selector error: grouped rows have no selection column. The corrected selector reads card-name buttons independently of column position. Four simple cases and the filtered Public case subsequently pass. A screenshot caught a route loading screen despite an earlier row assertion, so later qualification waits for the isolated page's requests to settle before checking rows. Those earlier attempts remain retained; they are not the final full qualification.

The strengthened five-case run has **four passes and one failure**. The failed regular exact Inventory case clicks Total cards after loading Card Name ascending, but its URL stays `sort=cardName&sortDir=asc` throughout the existing 10-second assertion. A three-repeat isolated probe has **two passes and one failure at the same boundary**. Neither result is a fix or a reliable all-pass qualification.

The failed trace records an actual sort=quantity, sortDir=desc component-response request. It returns HTTP 200 in about 64.5ms with the correct quantity-sort property and retained card rows. The response contains no redirect or streamed error chunk, and the trace has no recorded browser error. The cause of the client failing to apply the completed response is unknown. Thus this failure cannot be described as a missing click listener or solely slow server sorting. It is a related shared-workspace symptom; it does not yet reproduce all-column failure on the reporter's Public deployment.

The filtered Public scenario passes on this local image. The reporter's deployed revision, exact browser state and persistence of the Public symptom remain unqualified. Do not close #703 or infer production recovery from these local checks.

## Delivery state

This branch is a diagnostic draft, not a ready fix. Types pass for the current fixtures. Local original source projections and service conservation are checked against the fresh October 10 baseline. All 1092 retained originals (2832075218 bytes) pass fresh SHA checks. Private traces/reports/screenshots live under `.local-data/sorting-*`; no credentials, private reply bodies or images are committed.

Next safe step: inspect the two recorded failed client transitions, isolate the client navigation/commit boundary, and implement a coherent fix on this branch. Consider ordinary sort links only after evaluating filter, scroll, history, pagination, Public visibility and desktop/phone effects. Preserve the existing 10-second assertion and failed evidence; qualify complete affected workflows before marking the PR ready. Continue independent recognition work while any deployment-specific evidence remains unavailable.
