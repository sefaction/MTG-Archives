# Trade completion concurrency investigation (#309)

Base: `f32ebffbec91d5488e7e3318510d446bdc3d80d7`, after merged #874.
The source hypothesis is unproven until the actual action reproduces it.

The hosted-only harness compiles the checked-in action module without changing
its statements. It adapts request identity and Next cache invalidation only.
Real Prisma transactions, source removals, destination receipts, provenance,
audit logs, wishlists, notifications and announcement queue logic execute.
It does not qualify browser transport or authentication/session handling.

Scenarios synchronize duplicate final confirmations, simultaneous participants
and admin/participant overlap. Read barriers wait at most 1.5 seconds, allowing
a correctly serialized second caller to remain blocked rather than deadlocking
the test. Source lots contain 10/12 copies; transfers contain 2/3. Assertions
require one completion event, one receipt per line, four audits, correct source
quantities, conserved totals, preserved attributes and opener/pull/round/notes,
explicit destination and unchanged resident lots. A receipt failure checks real
transaction rollback. Missing/foreign destinations and nonparticipant calls
remain denied by the action.

The dedicated workflow uses standard GitHub-hosted Linux only. It installs
dependencies before creating a labeled internal Docker network; test processes
and PostgreSQL have no published ports or egress. Only the hosted checkout is
mounted read-only. Images and containers bind to immutable IDs; cleanup checks
exact run labels before removing only owned containers and anonymous volumes.
No local or server service, production data, external credential or paid resource
is used. Reports record source SHA/hashes, scenario outcomes, barriers and cleanup.

Initial publication is reproduction-only, with no product edit. Hosted results,
failed attempts and any supported fix will be recorded here before readiness.
