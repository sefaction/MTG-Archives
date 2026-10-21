# Unattended investigation boundary — October 20, 2026 Central

Related issue #844. The confirmed workflow is **sealed Commander League**, failing at final apply on Unraid. This remains distinct from the ordinary-deck physical-copy report #808. The actual failing list, incident request/revision/error and persistence outcome are not available in the current issue or retained investigation handoff.

Merged #849 repairs a demonstrated stale-pool revalidation/feedback problem, but no evidence attributes Brian's actual request to that problem. Existing diverse synthetic League success and controlled stale-pool rejection/retry checks are not repeated as incident acceptance. No real production import or new local runtime test was run during this checkpoint.

**Input boundary:** retain the actual failing list or faithful failing minimized list, League/deck/mode context, affected revision and approximate time/request reference. Correlate any retained server error to this final-apply attempt. Never infer the ordinary-deck cause from a shared generic error page. No response is required while Brian is unavailable; keep this checkpoint in a labeled draft PR and continue independent work.

Once evidence is available, reproduce final apply in an owned disposable League fixture with the same membership, pool restrictions, list and mode. Assert either correct reviewed quantities/commitments or an actionable restriction explanation with no partial writes. Compare complete before/after list, Inventory and audit state. Qualify desktop/phone preservation of review and intentional retry without relaxing League rules. Shared laptop runtime access remains reserved by its exact owner; merge, installation and actual reporter acceptance stay separate.

#844 remains OPEN/investigating. This source/issue reconciliation establishes a concrete evidence boundary, not an incident cause, fix, deployment or passing reporter-case test.

---
# League paste pool revalidation qualification

[PR #849](https://github.com/sefaction/MTG-Archives/pull/849) fixes narrow [#848](https://github.com/sefaction/MTG-Archives/issues/848). Related reporter incidents [#844](https://github.com/sefaction/MTG-Archives/issues/844) and [#808](https://github.com/sefaction/MTG-Archives/issues/808) remain separate and unverified. October 18, 2026.

## Result and scope

If a prepared League list contains a printing no longer present in its linked inventory, final apply now returns an actionable message in the review form before the deck transaction begins. The existing pool predicate remains unchanged. Ownership, locked-deck, physical-copy validation, transaction bounds and successful redirect are exactly the prior server source outside this bounded validation return.

The client explicitly submits the reviewed FormData in a transition, displays expected feedback, retains list/commander/import mode, and guards pending or duplicate submission. The mode control fits at 320 pixels. Unexpected server/database failures are not converted into a false success or an unsupported rollback claim. No automatic retry or general idempotency guarantee is added.

The final implementation avoids the reset observed with the first form-action candidates. React documents automatic form resets after successful action completion in its [form reference](https://react.dev/reference/react-dom/components/form); the regression tests the actual chosen mode and resulting quantities rather than assuming a reset handler works.

Current-main integration 623ce8943209e5bc5831ee37a8eb2384fcf3e26b is recorded at af40c22c512e2af32dec94ba7525747e668412ed; it leaves both changed application Git blobs exactly unchanged. The tested cumulative application is 4b6a0d0840f04b5639e7c3cc3c633d7ec53f7d09, preserving the earlier scanner batches including #847. This PR has no source dependency on unmerged scanner work.

## Local reproduction and acceptance

An owned disposable database and Chromium browser use 100 different synthetic printings, one public linked League location, an editable League deck and one commander. The actual old compiled image accepts the valid 100-line/100-copy list. Removing only that fixture's pool link after a second review then produces HTTP500 and a generic production error page. Its server diagnostic names the unavailable League printing. Existing deck rows, inventory and audit state remain unchanged. This controlled pool change does not establish Brian's Unraid incident cause.

The final compiled candidate passes:

- The same diverse valid import creates 100 rows, 100 copies and one commander without changing pool inventory or audits.
- A stale replace is rejected in the form without HTTP500 or a client exception. Full pasted text and Replace mode remain; existing deck rows, inventory and audits are unchanged. Only the explicit fixture pool unlink occurs.
- Restoring that link and retrying on the phone imports exactly 100 copies, retaining the commander and pool quantities. It does not append an extra copy of every line.
- Error feedback and the complete mode selector fit at 1366 and 320 pixels with no document overflow; the final phone screenshot is visually inspected.
- Shared-form ordinary import controls also pass: a three-copy list-only import changes no inventory/audits; a separate explicit physical-copy merge adds exactly three committed copies in quantities 1/2 and four audit entries. The resulting list quantities 2/4 reflect two deliberately requested merges. Original League pool rows are unchanged. These synthetic controls do not resolve #808.

All 142 relevant deck/League/import unit checks across 22 files and final typecheck pass. Parser/resolution helpers and row printing/physical controls are preserved by source comparison. Exact final report-head CI is recorded on #849 and in the checkpoint.

## Actual cumulative publication

Application image sha256:1fbbdef9e621aaf589e2f9aea8ee8f2623a6b31b6d33a0bc362bc9bbaa850383, platform sha256:cac93e40f5ef362c51b3cd5174e292162f2746921b6feb76dbc0de1416284f78, source digest 7141caee6c71a4e59af891865751cb7f22f988a95fc48de0d84b4eed6f82c469. Web compilation is rebuilt. The actual image retains base configuration/layers and verifies 333 library/script files plus both changed application files against the 627-entry manifest. The known #842 manifest gap for middleware.ts, types.d.ts and next-env.d.ts remains separately hash-bound.

Only the web, ordinary acquisition and catalog worker roles change image. Their actual source/platform/environment/mount/resource settings are verified. Twenty peer identities/settings/lifetimes, including all three existing native roles, are unchanged; native images and 333 library/script hashes per role remain exact. Native models, profiles, limits and inference behavior are not changed or requalified. Canonical Compose changes only those three image pointers.

Paired originals/correction/catalog/review records and the visual index remain unchanged. The post-publication 47.827-second idle/refresh interval is brief continuity evidence, not sustained resource qualification.

## Failed checks and resource limitation

Complete native memory-event conservation for the entire run **FAILED**. The unchanged primary printing worker's memory.events.max rose 1149 to 1464 (+315); OOM/oom_kill, other memory event counters, container identity/configuration/lifetime and restart count did not change. Its immediate publication baseline already contained 1464, which remains distinct from the initial 1149. This observation is retained under existing #803/#760 context; no cause, native-child failure or relationship to builds is established. At one read-only observation, primary work had 225 pending / 0 running; that is not proof of inactivity throughout the run. The failed whole-run comparison is not relabeled as passing resource acceptance.

The UI/application publication result is qualified separately. Historical failed native intervals remain failed/unknown; this batch does not establish sustained load, memory safety or historical cause resolution.

Earlier author candidates also failed and remain retained: the initial handled error reset Replace to Append and doubled quantities on retry; bubbling and capture reset handlers still failed the strict mode assertion. Those candidates were never published to shared review. Only the explicit-submit candidate and its responsive follow-up pass the complete regression. An initial locator timeout before the controlled mutation and temporary scope-helper whitespace/syntax/duplicate-guard errors are retained as harness failures rather than product failures.

## Remaining boundaries

Brian confirmed that #844 occurred on Unraid. Its failing decklist, affected revision, actual server error and persistence outcome remain unavailable; the focused list request is pending. No actual production import is repeated and no Unraid deployment, capacity inspection, merge, issue closure or historical data repair occurs. The 64 decimal GB per-owner correction limit and 2% random controls remain unchanged.

Private evidence is in .local-data/league-apply-diagnosis, including baseline, failed candidate directories, source commits, final source/CI, browser, ordinary controls, runtime, paired data and memory-counter records. The separate reviewer owns readiness, individual approval/merge and final issue disposition. #844/#808 and resource investigations remain open.
