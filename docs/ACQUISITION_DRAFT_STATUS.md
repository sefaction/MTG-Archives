# Unsaved scan correction status

Issue: https://github.com/sefaction/MTG-Archives/issues/694

Editing a saved scan review now shows **Unsaved correction** beside the current printing and attributes, and **Unsaved correction · save or cancel changes** in the card header. Restored browser drafts use the same status. An acknowledged save or cancelling changes restores the saved status; committed copies continue to show **Added to Inventory**.

The unchanged local application reproduced the defect: the stored review remained NM with its revision unchanged and no Inventory addition, while the displayed LP choice still said Review saved. The baseline failed the new unsaved-status assertion and cleaned its owned fixture. The baseline screenshot and JSON remain in the private local test artifacts.

Only two presentation labels change. Review persistence, recognition diagnostics, correction attribution, retention, sampling, permissions and explicit Inventory confirmation retain their existing behavior.

The first corrected four-case group passed both lost-response/retry cases but failed the two normal cases after actual Inventory commit: the header correctly said Added to Inventory while the compact label still said Review saved. The shared processing helper describes review/recognition progress and has no commit input. The compact label now gives the component's committed state precedence, matching the header. This is a related preexisting presentation inconsistency; the original failed group and traces are retained, and its assertions are unchanged.

## Qualification

Four final actual API/browser cases pass at 1366px desktop and 320px phone widths (49.4 seconds, no failures, skips or retries). They cover printing/finish/condition changes with the saved revision unchanged, reload, cancel, acknowledged save, a reply lost after an actual server save, idempotent retry without an extra correction event, and explicit Inventory commit with a stale browser draft. Saving alone writes no Inventory; each normal case adds exactly one copy through the separate confirmation. The uploaded original's stored and actual SHA-256 remain equal. Visible-status screenshots clear the actual sticky progress panel; edited, acknowledged and committed desktop/phone states were inspected.

Sixteen affected existing browser workflows also pass (284.7 seconds, no failures, skips or retries): fast corrections/private history, draft protections, desktop/phone Inventory handoff, bulk selection, proposal identity, five lost-response recovery cases, 14-card paging and desktop/phone scroll targets. Together these cover 20 distinct workflows. The earlier four-case functional rerun passed before improving screenshot framing; it is not four additional distinct cases. All eleven completed fixture namespaces and their independent correction records are absent after teardown.

Local core verification passed 858 tests with zero failures/skips, types and all 13 client manifests before the committed-label follow-up. Final types and the updated required-installer Docker production build also pass; the current PR head's required GitHub checks are verified separately before marking it ready.

The cumulative local build includes main and separately unapproved PR684/687/688/690/693 plus this batch. Only web was recreated. Image `sha256:e723ce63be540395e210e4e0f6b8e0eb754ef95f3c27030eb7fd8509e3c34d98` matches all 595 application inputs, digest `f109899fa1ac020b56ea650fe02e0d6830b697b897986b33090d27067705ef86`. All 308 shared native inputs match each existing recognition, visual and printing worker. All 13 ordinary services are running, web is healthy, and the other 12 services retain their images, start times, restarts, mounts and limits. Seven original table projections are conserved. Fresh before/after checks verify all 1,092 retained originals and 2,832,075,218 bytes against their stored SHA-256 values and preserve their identities.

Private baseline, first failed corrected group, final JSON, traces and screenshots remain in the local feature/cumulative `.local-data` folders. Production sampling, retention, worker logic and recognition are unchanged. These controlled presentation cases do not establish recognition accuracy or physical scanner acceptance. Issue694 remains open until this PR receives individual approval and merges.
