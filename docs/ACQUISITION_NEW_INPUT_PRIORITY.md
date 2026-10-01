# First scan result priority

User-approved policy: new inputs take priority over historical reprocessing within
an owner. Cross-owner processing turns remain ahead of that preference.

For each stage, an artifact/candidate pair with no completed result goes ahead of
pairs with a previous completed result. This covers first uploads and scans,
retakes with a new artifact, and retries until a first result succeeds. A model or
candidate revision refresh of the same completed input is background work.
Classification is derived from saved evidence and survives worker restarts.

Apply this policy both before the bounded 32-source admission window and before
run heads are selected for claims. Equal-class jobs retain durable run rotation
and availability/FIFO. Background-only owners retain their processing share;
historical jobs remain queued and resume when that owner's new work drains.
Already running jobs finish under their existing lease; this does not interrupt
native inference. Continuous new input can delay that owner's refreshes.

No schema migration, scanner capture, crop or reading-zone changes. Immutable
originals, human reviews, stale revision/authorization fences and explicit
Inventory confirmation retain their existing behavior.

The guarded disposable PostgreSQL verifier covers all four recognition stages,
104 same-owner refreshes across40 runs and within one run, bounded source admission,
new-artifact retakes, another owner's background-only work, reconnect, resumption
and zero Inventory. Existing concurrency, retry, expiry, stale-input, review,
canonical-photo and scanner checks remain required.
