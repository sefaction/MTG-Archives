# P2 durable orchestration acceptance map (#304)

Source anchor: main b810f06a. This batch adds two bounded reconnect/replay controls; it changes no runtime behavior. Synthetic software evidence does not establish physical scanner behavior, independent printing accuracy or sustained throughput.

| Requirement | Existing real database control | Remaining boundary |
| --- | --- | --- |
| Exact 263 plus 37 untouched; best effort 263 plus 37 overflow | verify-acquisition-orchestration.ts: reversed batched delivery, fresh Prisma client replay, candidate identity/order and allocation assertions | Existing foundation evidence; not physical feeding |
| Stable run/event identity and conflicting replay | verify-acquisition-store.ts: concurrent request identity, conflicting receipt race, persisted reconnect and ordered concurrent events | Exact installed helper/run provenance belongs in scanner integration |
| Versioned jobs and competing leases | verify-acquisition-orchestration.ts: duplicate enqueue, distinct pipeline versions, two workers, lease handoff, old heartbeat/fail/completion rejected | Full input/catalog/model/index integration still needs an explicit covering evidence map |
| Human decision wins over late output | verify-acquisition-orchestration.ts: saved review causes later recovered job completion to return SUPERSEDED; candidate remains counted | Other stage-specific integration remains separate |
| Failure at candidate 147 consumes its slot | verify-acquisition-orchestration.ts: candidate147, bounded retries/exhaustion, timeout/cancellation, unresolved copy retained | No recognition-accuracy claim |
| Finite source completes below target | New 3-of-7 COMPLETE case reconstructs unchanged target, three physical candidates, no overflow and targetReached=false after reordered replay and fresh client | Explicit hardware SOURCE_EXHAUSTED outcome is separately represented below |
| Explicit scanner source exhaustion | verify-scanner-runs.ts: REPORTED_EMPTY / SOURCE_EXHAUSTED, retained images, image-derived count and zero Inventory | New fresh-client final-ACK replay checks the complete durable session, derived summary and scanner batch outcome remain identical |
| Restart/cross-layer recovery | Existing source-specific lease, replay, restore and retention tests; #310 tracks release recovery | #310 remains open; no wholesale release acceptance transfer is claimed |

The two new controls use the existing guarded disposable acquisition database and exact existing fixture owners. They create no hardware job, shared-laptop database action, recognition model invocation or automatic Inventory commit. Fresh clients are disconnected in finally blocks; existing fixture cleanup owns all created records. Run through Acquisition PostgreSQL integrity CI. Before review readiness, inspect actual exact-head results; source assertions alone are not passing execution evidence.

#304 remains open. [Prospective helper identity](SCANNER_HELPER_IDENTITY.md) adds the previously missing authenticated execution/payload binding and inherited photo provenance; historical/legacy and ambiguous prior attempts remain unknown. Stage-specific catalog/model/index snapshots remain separate from this managed helper report. Broader software scale/recovery stays with #310 and independent recognition with #307/#463. Phone/provider and GPU deferrals stay under their existing future issues. Do not repeat ordinary physical scanner acceptance or close a tracker from these narrow additions.
