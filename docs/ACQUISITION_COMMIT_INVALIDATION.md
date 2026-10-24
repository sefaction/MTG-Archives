# Acquisition commit preview and receipt failure controls

This test-only batch covers a recorded #309 remainder on main3b06f208. It changes
the existing complete-service PostgreSQL verifier and acceptance map, with no
application, schema, permission, capacity or transaction-limit change.

The real `commitAcquisitionCards` service now receives an old preview after each
of three independently established persisted changes:

- Session ownership changes to the other fixture player: the original actor is
  refused. The fixture restores the owner in `finally`.
- The destination layout changes: the old confirmation is refused. The fixture
  restores its layout in `finally`; normal revision triggers remain enabled.
- A compatible FOIL decision is saved through the actual review service: the old
  confirmation is refused and a new preview shows FOIL. The fixture restores its
  original review and printing support in `finally`.

Each refusal compares every field of the scoped session, candidates, photos,
Inventory, audit, receipts and physical memberships immediately before/after
the attempted commit. The changed input itself remains preserved. Owner/layout
are explicit database fixture mutations, not authenticated editing-route or
concurrent-writer qualification. Review/source behavior and current permission
checks are exercised, not mocked results.

The existing transaction-fault loop also injects at actual AcquisitionCommit
creation, after Inventory and audit writes. Faults apply only to create/createMany,
so the receipt's earlier replay lookup does not trigger the test. Audit-create
and membership-create faults remain. Each must preserve the same scoped full-row
state, with no partial Inventory/audit/receipt/member or photo-retention effects.
The subsequent unchanged normal concurrent commit/replay is the recovery control.

## Evidence and limits

Changed-file lint and whitespace pass. The complete affected verifier is run in
an isolated, network-unpublished PostgreSQL database with the actual migrations.
Runner/DB limits are768/384MiB, oneCPU each with no extra swap; the existing review
apps/databases are preserved. Required exact-head CI and independent review are
recorded in the PR before readiness. No app build/browser reload is needed for
these test/documentation changes.

An initial inherited fingerprint guard rejected the new disposable database name
after migrations, before fixture creation or target tests. That setup failure is
retained. The corrected run passed with all84 public-table fingerprints conserved.
An exact client-schema check found byte differences: comparison traced these to
Prisma formatting and index-declaration ordering, with no model/field change.
The client was regenerated from the exact source schema and the complete affected
verifier passed again, with all84 full-row fingerprints conserved and zero cgroup
OOM/max events. These are affected-verifier passes, not a local full-suite pass.
Private logs, source/client identities, full-row cleanup fingerprints and terminal
resource retirement remain under `.local-data/p7-invalidation-20261023/`.

This is persisted preview invalidation and declared software-fault evidence.
It does not prove arbitrary writer interleavings, natural storage/process loss,
the263-to258/five-pending reassignment UI, installed browser behavior, scanner
operation, production deployment or full #309/#302 acceptance. Those requirements
remain open with the existing writer map and original failures preserved.
