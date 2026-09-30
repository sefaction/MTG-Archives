# Website scanner Start recovery

Issue #527, on the individually unapproved #526 scanner stack. This does not
change native acquisition, recognition, review or Inventory commit.

The browser saves one validated, immutable scanner Start request in per-tab,
per-account session storage before sending it. Settings and destination are
locked until its outcome is recovered. Source polling cannot change that intent.
No connection credentials or images are stored there.

An uncertain POST response triggers an owned, read-only lookup by the existing
request identity. Reload also performs only that lookup. Retry first recovers an
accepted batch; only if none is found does the explicit retry resubmit the same
request. The existing server identity/payload/ownership/capacity and native START
gates remain authoritative. Missing lookup results do not prove no feed occurred
and never justify generating a new request identity.

The lookup repeats current ownership and role checks but does not require the
helper to remain online. An already accepted run is recovered even when current
capacity or connectivity changed. Recovery itself does not authorize START.

Storage failure prevents a new scanner POST with guidance. Photo-only input does
not require this storage. Malformed saved scanner state fails closed; Recent
batches remain available. A late ACK cannot erase a newer intent.

## Evidence and limits

The original browser test needed a timing correction: waiting for the failed
response before the next source poll reproduced the failure. Earlier prematurely
passing runs are not evidence of recovery. The corrected baseline lost its batch
after refresh/retry and retained its failure trace privately.

Focused storage tests cover account isolation, reload, old ACKs, invalid content,
unexpected fields and unavailable storage. Disposable scanner database checks
cover missing/foreign identities, offline accepted-run recovery and unchanged
execution authorization. Local browser cases inject an accepted POST with lost
acknowledgement and a POST that never reached the server, plus a recovery outage,
source polling, locked fields, reload and explicit retry. Test agents never run a
helper or motor; photos and Inventory remain empty. Browser results are recorded
in the checkpoint after local loading.

Pending intent is per tab, not a cross-computer or cross-tab coordinator. Closing
the tab can lose that browser intent; existing server unfinished-run checks still
prevent a second feed through the same agent. A definitely rejected request may
remain locked to its original setup until it can be retried; replacing a pending
setup is tracked in #529 and requires a separately qualified safe reset rather than assuming a missing
lookup proves that no older request can finish. No timeout disposes native state.
