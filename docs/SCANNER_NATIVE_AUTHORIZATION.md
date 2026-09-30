# Native scanner authorization loss

Issue #522, following preflight #519 and temporary-outage #516. This batch needs
both dependency branches; none of their approvals is implied. All work and
qualification in this batch are local. Recognition and Inventory semantics stay
in the existing acquisition pipeline.

## Behavior

- Native run and image endpoints return403 for a known revoked/invalid connection,
  409 for known run/epoch/phase/count conflicts,400/413 for malformed protocol or
  oversized metadata, and503 with Retry-After for unexpected service failures.
  Responses omit exception details and use no-store.
- The helper treats401/403 as permanent authorization loss at poll, preflight,
  claim, heartbeat, image delivery and completion. Before motor authorization it
  exits without starting. During acquisition it requests the existing backend
  stop/drain policy, stops network retries, waits for the native task to finish,
  and only then releases the spool, backend and device lock. Hard cancellation
  is not used. Late transfers remain in the private spool.
- The existing connection handler then disables the saved connection and stops
  that service. Credentials and originals are retained; opening a new connection
  does not discard or automatically refeed an old run.
- A temporary503/network failure or lost upload acknowledgement continues to
  retry the same artifact identity and bytes. Recovery of an existing local
  journal remains transfer-only, with server epoch/binding/receipt fences.

## Qualification

- Seven controlled backend/HTTP cases: poll401, preflight403, claim403, active
  heartbeat403, active image403, finish403, and503 plus lost acknowledgement.
  The active-denial cases intentionally produce a late second transfer after
  stop, verify both originals survive, assert native completion precedes
  disposal, and attempt transfer-only recovery without constructing a backend.
- Release build and the complete native selftest pass with zero warnings/errors.
  These cases use a generic fake backend, never a physical scanner.
- Disposable PostgreSQL acquisition/import integrity passes, including actual
  revoked credentials mapped403 and changed remaining capacity mapped409.
- Focused response tests, TypeScript and lint pass. The opt-in local browser/API
  fixture verifies the real native routes, no photos/Inventory, and owned cleanup.
  Its loaded-image result and installed-helper evidence belong in the checkpoint
  and PR; creating the fixture alone is not a passing result.

## Limits

An SDK stop request is not proof the feeder stopped at a particular card. The
PS286 currently drains when graceful stop is unsupported. If the driver hangs,
the helper waits rather than dispose native resources while cards may remain in
transport; recovery requires operator attention. Real revoked-mid-feed behavior
has not been tested. Physical boundary/side evidence remains unknown.

409 conflicts still require reconciliation and retained-journal investigation;
this change does not solve every retry/status UX case. Malformed image content
can still surface an unexpected service failure. Public packaging/license and
clean-host prerequisites remain separate gates. No production connection is
resumed and no motor is run by the automated fixtures.
