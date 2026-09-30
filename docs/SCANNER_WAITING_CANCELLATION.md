# Cancelling a waiting scanner batch

Issue #524; dependent on native authorization #523 and its separate dependencies.
The default waiting-scan cancellation needs no physical count form when the
server can establish that it never authorized START. No driver call is added.

Under the same serialized ScannerRun lock used by claim, cancellation checks:

- the current account owns the batch;
- the run is queued or a legacy cancellation before START;
- there is no execution ID and the independent site epoch still matches;
- no independent durable START marker exists;
- the session is capturing or already cancelled;
- no acquisition artifact, candidate, reserved slot or photo exists.

On success the run records `CANCELLED_WITHOUT_START` reconciliation, clears the
transient preparation problem, and cancels the session. This is evidence of no
authorized feed, **not an observed physical count** or an empty-feeder claim.
Repeated cancellation leaves the session revision unchanged. A new batch can
be created without another zero-count confirmation; the operator still chooses
when to load cards and explicitly start it.

If a claim wins the lock, cancellation becomes the existing drain request and
does not automatically reconcile. If cancellation wins, a later claim cannot
authorize feeding. Restored START markers, changed epochs, non-null execution
and unexpected acquisition data reject the no-START cancellation. They retain
the existing evidence and require reconciliation rather than imply no feed.
Unreadable control storage fails closed.

The UI explains why no count is needed and shows New scanner batch. Clean
completed runs and interrupted native runs keep their existing image-count or
manual-reconciliation behavior. Recognition, default finishes/condition and
explicit Inventory commit are unchanged.

## Verification scope

Disposable database checks cover no-START replay, foreign owner, changed epoch,
execution/slot uncertainty, a durable START marker surviving database rollback,
and three concurrent claim/cancel requests with both outcomes accepted only
when their evidence is consistent. The local browser case covers cancel, reload,
no count form and next-batch navigation. These protocol fixtures operate no
motor and do not qualify physical feeder safety or recognition accuracy.

The first database run failed because the additional lifecycle fixture reused a
deliberately full destination from the prior capacity test. The failure remains
private; subsequent lifecycle cases use an unbounded destination after that
capacity assertion. A second fixture run reached the existing eight-active-helper
limit; each isolated uncertainty/race helper now revokes its own connection after
its assertions. The product limit stays intact. The final disposable
acquisition/import rerun passed and cleaned its owned PostgreSQL/data. The
healthy local browser case passed1/1 in19.9s with reload, no count form,
next-batch navigation, zero Inventory and owned cleanup. Typecheck/lint and
source verification passed. Exact hashes are in the PR/checkpoint.
