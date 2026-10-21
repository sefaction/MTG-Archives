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

## Reproduction and bounded repair

Run [39529514059](https://github.com/sefaction/MTG-Archives/actions/runs/39529514059)
on exact `669e31bdcab2b79b4fca108e253975ba7a25e342` reproduced duplicate
completion for duplicate final confirmations and admin/participant overlap:
two events, four received lots, eight audits, source quantities 6/6 instead of
8/9. The simultaneous-participant control transferred once. Inventory rollback
and destination/authorization denials passed, as did exact-owned cleanup.
This initial harness explicitly extended transaction timeout to 20 seconds;
the final harness forwards the application's transaction options/defaults
unchanged and reruns the old-source failure control alongside the repair.
Narrow bug [#878](https://github.com/sefaction/MTG-Archives/issues/878) records it.

Completion now locks the trade row within its transaction before loading fresh
status, confirmations, destinations and source references. A participant's
confirmation is conditional on physical-exchange status and that participant's
timestamp remaining null. A stale request cannot overwrite a completed trade
or emit another confirmation event. Existing explicit destination validation,
admin reason/authority, provenance and receipt services remain in place.
Transfer failure retains the preexisting separately saved confirmation; the
inventory/receipt/completion transaction rolls back. This is not a new guarantee
that confirmation and transfer are one transaction.

The first run39529269677 failed before action execution because the fixture used
top-level await under CommonJS. Its cleanup passed. The repaired harness wraps
async execution and explicitly checks out the PR head rather than GitHub's
synthetic merge commit. Failed artifacts remain retained. The fixed-head hosted
run, exact-head normal CI and independent review remain required.

Run [39529988169](https://github.com/sefaction/MTG-Archives/actions/runs/39529988169)
on exact `79246410780f7a7c74ad735fb8548119221924ae` reruns the old-source
failure and candidate with unchanged production transaction defaults. The old
source again duplicates final/admin transfers (6/6, four receipts, eight audits).
All three fixed cases finish once (8/9, two receipts, four audits), with exact
attribute/provenance/resident/total conservation. Rollback and denial controls
pass; three owned containers and the internal network are removed. Independent
source review found no blocking product issue. Its suggested selected-context
and clean-checkout fences are added for the final run; that run also strengthens
audit quantity assertions and injects failure on the second receipt after the
first receipt and audit have executed.

The remaining #309 all-writer/phase acceptance is broader: this does not qualify
arbitrary unrelated Inventory writers, nonphysical trade actions, browser/session
transport, historical data repair, deployment or user acceptance.
