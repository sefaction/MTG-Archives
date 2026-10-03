# Current counted-source admission

[Issue612](https://github.com/sefaction/MTG-Archives/issues/612) records a reproduced
gap: a queued counted run received its first feed authorization after the helper
reported that source as Unsupported. A new disposable PostgreSQL regression
failed against the original implementation with `Missing expected rejection`.
No native scanner process, source or motor was used.

New counted batch admission, first durable START and explicit refill now require
the current helper discovery to contain the same counted route, with Qualified
or KnownWorking status and a heartbeat less than 30 seconds old. Missing,
changed, Unsupported, GenericUnqualified and offline sources refuse before new
START markers or refill/session mutation. Admission rechecks inside its database
transaction after locking the helper; a refill stores the current source record.
Serializable transactions preserve concurrency with helper heartbeat updates.

Existing START replay, original-image delivery, finish, reconciliation and saved
refill-request recovery retain their existing authority. The check does not stop
an active transport, infer its physical position, or enable the suspended native
count route. It relies on the helper's discovery report; it is not independent
hardware qualification or a remedy for an old helper that falsely reports a
working source. No version whitelist or fixture exception is introduced.

Real disposable PostgreSQL coverage checks refusal without a START marker,
unchanged queued reservation, missing/changed/unsupported/unqualified source,
offline heartbeat, no orphan session on refused admission, and no new run or
phase change on refused refill. A source qualification change after START still
allows existing replay and synthetic image delivery. The existing 83-image,
capacity, concurrent admission, refill, series, Stop and recovery suite remains
part of the verification. Browser coverage exercises actual HTTP409 refusal
followed by normal counted/refill workflow with the restored fixture source.

This software gate does not qualify physical counts. The empty-source
blank-retention/restoration/shutdown check and new supervised small trials
remain pending. Installed laptop helpers remain stopped; no production
deployment or merge is authorized.

## Local qualification

The full disposable PostgreSQL acquisition integrity suite passed (94.1 seconds),
followed by shared receipt/import integrity (44.1 seconds), with owned fixture
rows, container and anonymous volume cleaned. Typecheck and 29 focused scanner
unit checks passed. All three CI checks passed at `85b1658`; a subsequent browser
assertion/documentation-only revision requires fresh final-head CI reconciliation.

The cumulative healthy local web image is
`ae668b1748528f1c579a33abb5546fe52d69197b7de8d76f908f083aea420667`.
All 532 source inputs match digest
`12478241946929a6c962e10f8602a11b0ef82216b6e7530c8962ba7e38c66e3e`.
The counted browser test passed (18.0 seconds), including actual HTTP409 before
START and a readable paused-refill refusal followed by successful same-batch
refill. The helper API intentionally returns its existing generic conflict
message; the operator refill form shows the setup instruction. The section-series
browser test also passed. Desktop and 320-pixel phone layouts passed width checks;
the paused phone screenshot was visually inspected. The first combined run began
before web startup completed, failed at login with ERR_EMPTY_RESPONSE, and cleaned
its fixture; the affected test was rerun after healthy status.

Only the local web service was reloaded. All five acquisition worker generations
remain unchanged. The Inventory full-row hash remains
`742d2fa870de453d80f151c6368e4f82` (10,280 rows / 12,482 copies), and counted/series
browser fixture users are absent. The unchanged complete scanner installer from
PR611 retains its qualified source identity. No physical scanner was opened.
