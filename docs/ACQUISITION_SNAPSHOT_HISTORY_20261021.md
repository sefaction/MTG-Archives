# Historical snapshot comparison checkpoint

This entry is preserved verbatim from `378e868f5dd6fdc3507aef36a66d381e1695b2a3:docs/WORK_CHECKPOINT.md`. Pending statements describe the historical checkpoint; the PR records current validation. Main's checkpoint is retained unchanged during integration.

## Deterministic short-source conservation comparison — October 21, 2026

Follow-up to merged #879 under #308/#302; branch fix/acquisition-snapshot-order.
Failed main run 39611552235 at merge 1d235f45 is preserved. The unchanged short-source
assertion at orchestration line 315 compared unordered relation arrays positionally.
Only test comparison now clones and sorts artifacts, candidates and observations
by identity; every field and ordered physical tuples/receipts/corrections remains
in the deep comparison. Six permutations reproduce old failure; 12 data mutation
controls still fail comparison. 13 focused tests and full TypeScript pass.
Initial fixture draft incorrectly treated the reducer result as a wrapper; corrected
before publication. Independent review and hosted PostgreSQL validation pending.
Main run is completed/failure; wishlist job API remains in_progress despite its
completed PASS/cleanup log, so no terminal success is inferred for that job.
No product/schema/dependency/service changes, deployment or broad issue closure.

