# Standard-user scanner workflow audit

Goal: the complete workflow in the user's active scanner-audit request, including
setup, daily connection recovery, continuous batches, asynchronous updates,
fast recognition corrections and explicit Inventory addition. Recognition accuracy
and fi-7160 qualification remain separate. No merge or production deployment is
authorized by this audit. Live GitHub and the cumulative checkpoint are authoritative.

## Findings and delivery

| Area | Finding / response | Evidence and remaining acceptance |
|---|---|---|
| First install | Website download and Windows protocol pairing replace PowerShell | Merged #508; locally installed self-contained helper; browser download/pairing/discovery passed. Public notices/source and clean-host prerequisites still incomplete. Normal Windows/browser prompts require hands-on review. |
| Worker lifetime | Repeated discovery/duplicate helper processes could accumulate workers and provoke the Plustek proxy | Merged #512; #513 update/revocation handling. Actual 95-second discovery soak held at most one owned worker; revoke exited0/worker0. New physical WIA600 observation still pending. |
| Temporary outages | Pair/pulse returned403 for every exception, potentially stopping a valid helper | #515 / PR #516: known denial403, input400/413, service failure503. Ten focused tests passed; actual installed helper retried503, polled after recovery, then stopped on403. No hardware or Inventory changes. |
| Reopen/restart | Start menu helper only explained pairing; users could create another pairing instead of reopening | Draft #517 on #513: site-only Open scanner helper, saved-connection resume, duplicate service lock and disabled revoked records. Site/lock/config selftests pass; installed website/browser qualification pending. |
| Daily device reconnect | WIA refreshes every30s; TWAIN enumeration is cached per service to avoid repeated vendor startup | Actual unplug/replug and TWAIN driver-error/partial-discovery behavior need further tests. Do not imply that cached TWAIN identity proves physical presence. |
| Start batch | Count entry and repeated choices slowed feeder use | Merged #510/#512: scanner-preselected setup, visible Start scanner batch,600DPI, feeder-until-natural-end. No pre/post count entry on clean runs. Silent doubles/unknown physical boundaries remain explicit limits. |
| Review density | Duplicate bulk/individual lists and expanded defaults obscured the matches | #488 Simple/Advanced; #514 one incremental bulk list, bounded four-request loading, preserved drafts, collapsed defaults/destination. Desktop/320 screenshots and ordinary fixture workflow passed. |
| Inventory handoff | Final addition was hard to find after confirming matches | #514: batch-level Add confirmed cards, bulk-save handoff, preview shortcut after reload, separate final Add. Normal fixture test proved zero Inventory before final confirmation and one correct audited addition afterward, then full owned cleanup. |
| Asynchronous results | Stable rows/drafts must survive polling, filtering and out-of-order results | Existing streaming/native tests provide partial evidence. Explicit larger-batch interaction and out-of-order correction audit still pending; one-card acceptance does not prove scale. |
| Corrections | Card alternatives/search exist, but the number of clicks and keyboard progression have not been fully audited | Pending: measure wrong-match replacement, search/printing image selection, keyboard navigation, next questionable result and destination/metadata preservation. No automatic confidence/model changes in this audit. |
| Error guidance | Offline helper has little actionable explanation | #517 adds Open helper and USB/power/internet/driver guidance. Still audit native source errors, upload/backpressure, interrupted-run reconciliation and capacity errors for clear next actions. |
| Continuous batches | New scanner batch preserves input; next-batch destination/source continuity needs task observation | Pending: measure repeated batches and decide whether saved choices safely reduce interactions without changing ownership/capacity authority. |

## Completion criteria still open

- Finish and verify installed reopening/restart and normal device reconnect.
- Audit source-driver failures without allowing a broken source to hide useful sources.
- Finish the fast-correction, keyboard and ambiguity-attention workflow; quantify interactions.
- Verify changing asynchronous results do not lose corrections or destination metadata.
- Verify repeated batches feel continuous and dynamic location/capacity errors are understandable.
- Document distribution and physical limits, and catalogue any deliberately deferred work.
- Load completed batches cumulatively locally and report every unapproved PR when the user returns.

The broad audit goal is **not complete** merely because individual helper or
one-card fixture checks passed. Approval wait is not a reason to stop independent
implementation. A real physical scan requires fresh feeder/transport confirmation.
