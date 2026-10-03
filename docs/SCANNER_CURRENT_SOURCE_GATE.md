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
