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
| Reopen/restart | Start menu helper only explained pairing; users could create another pairing instead of reopening | #517 on #513: site-only Open scanner helper, saved-connection resume, duplicate service lock and disabled revoked records. Installed0.3.3 website reopening, real source discovery, three refresh intervals, revocation shutdown and owned cleanup passed. |
| Daily device reconnect | WIA refreshes every30s; TWAIN enumeration is cached per service to avoid repeated vendor startup | #511 follow-up scopes per-source discovery isolation. A TWAIN exception can prevent WIA/heartbeat and repeat the failed attempt (code inspection, not a new900-worker reproduction). A native hang must not be treated as a completed timeout. Actual USB reconnect/driver-dialog behavior still needs hands-on evidence. |
| Start batch | Count entry and repeated choices slowed feeder use | Merged #510/#512: scanner-preselected setup, visible Start scanner batch,600DPI, feeder-until-natural-end. No pre/post count entry on clean runs. Silent doubles/unknown physical boundaries remain explicit limits. |
| Review density | Duplicate bulk/individual lists and expanded defaults obscured the matches | #488 Simple/Advanced; #514 one incremental bulk list, bounded four-request loading, preserved drafts, collapsed defaults/destination. Desktop/320 screenshots and ordinary fixture workflow passed. |
| Inventory handoff | Final addition was hard to find after confirming matches | #514: batch-level Add confirmed cards, bulk-save handoff, preview shortcut after reload, separate final Add. Normal fixture test proved zero Inventory before final confirmation and one correct audited addition afterward, then full owned cleanup. |
| Asynchronous results | Stable rows/drafts must survive polling, filtering and out-of-order results | #521 controlled three-photo browser proves draft/filter retention, out-of-order suggestions, keyboard progression, real saved-review/reload, original digest and destination/default preservation. Larger-batch interaction remains a separate scale gate. |
| Corrections | Opening search, editing and moving to the next unsaved result required repeated actions | #521 direct selected-name search beside printing images, valid finish/condition preservation, Save and next, Ctrl+Enter/Ctrl+Shift+Enter, stable-order wrap and honest awaiting-saved-review labels. Desktop/320px case passed1/1/17.3s; six explicit correction actions with an optional condition edit. No confidence/model change or accuracy benchmark. |
| Error guidance | Offline/preparation failures were hidden behind Waiting | #517 reconnect guidance; #519 bounded preparation codes, actionable guidance and same-run recovery. Eight generic failure/recovery cases and real browser1/1/18.3s passed. Actual disk exhaustion/native hang remains untested. |
| Native denial | Active run transport retried revoked credentials indefinitely | #523: typed403/409/400/413/503; permanent denial drains and awaits completion before disposal, keeps late originals, disables connection. Seven generic denial/outage/ACK-loss cases, real HTTP1/1/7.0s and installed0.3.5 selftests pass; no physical mid-feed revocation test.409 conflicts/driver hangs need reconciliation/operator help. |
| Cancel waiting | Proven unstarted cancellation still required zero count/empty feeder confirmation | #525 on #523: serialized no-START/epoch/execution/artifact proof; automatic no-START reconciliation, idempotency and next batch. Database and local UI1/1/19.9s pass including restore/concurrent races, reload/no count form and next batch. Uncertainty fails closed; no observed physical count is invented. |
| Continuous batches | Destination/source/default choices were repeated | #526 on #525: settled owned preferences, fresh run/target/empty state, explicit Start; unavailable location/section/source stays clear. Refresh capacity preserves choices and full disables Start. Database/controlled browser1/1/23.1s pass;1366x768 Start fits first setup viewport,320px has no overflow. One owned Inventory seed for occupied capacity is removed; no new scan commits. Physical/large-list acceptance remains open. |

## Completion criteria still open

Website Start recovery (#527 / PR #528) now retains one immutable per-account/tab
request through source polling, lost responses and reload. Recovery is owned and
read-only, including an offline helper; explicit retry keeps the same identity.
Disposable integrity and focused storage tests pass; grouped browser3/3 and final
recovery2/2 pass, with settled setup changes and photo-only storage independence,
zero photos/Inventory and no motor. 320px has no overflow. #529 adds explicit
Change scanner setup with durable identity retirement, cancellation of proven
empty partial sessions and adoption of accepted batches. File/disposable phase
race and ownership/START evidence checks pass; cumulative browser acceptance is
pending. Missing lookup is not no-feed proof.
This PR and each dependency require individual approval.

- Installed reopening is verified; normal physical device reconnect remains open.
- Audit source-driver failures without allowing a broken source to hide useful sources.
- Fast correction/keyboard/asynchronous metadata checks are verified on controlled
  fixtures; larger lists and physical end-to-end task acceptance remain open.
- Controlled continuation/capacity refresh is verified; real-task and larger-list
  continuity remain open. Unsaved correction navigation also needs audit.
- Document distribution and physical limits, and catalogue any deliberately deferred work.
- Load completed batches cumulatively locally and report every unapproved PR when the user returns.

The broad audit goal is **not complete** merely because individual helper or
one-card fixture checks passed. Approval wait is not a reason to stop independent
implementation. A real physical scan requires fresh feeder/transport confirmation.
