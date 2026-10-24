# Acquisition web-server process-loss qualification (#310)

## Declared boundary and stopping criterion

The acquisition validation plan explicitly requires server restart recovery before and after finalization/ACK. This opt-in test covers a real SIGKILL/restart of a newly isolated Next server while its browser and PostgreSQL stay alive. It complements the separate browser-process and database-process tests. Stop after the two declared phases pass at desktop1366 and phone320, or investigate the first unexplained failure. No additional load or physical scanner session is implied.

Four generated JPEG originals enter the real authenticated upload/review workflow: three explicit human selections and one pending card. Controlled processing jobs are marked failed without running recognition. These fixtures establish software persistence/retry behavior, not optical accuracy.

## Execution and protection

`tests/ui/acquisition-server-loss.spec.ts` refuses normal execution unless `MTG_SERVER_LOSS_TEST=1`. A new internal network, sole PostgreSQL data volume, and private upload volume belong to one run and random nonce. The exact web image/container, labels, namespace, sole upload mount, database target, restart policy and process state must match before either fault. No port is published and no production name, path or existing volume is a destructive target.

A small independent network anchor preserves the localhost browser origin while the server is absent. PostgreSQL and an independent fixture client have separate private network endpoints; the server and browser controller share the anchor namespace. Only the server and fixture client share the new upload volume. The database, anchor, fixture client and controller retain their original IDs, images, configurations and StartedAt values. Their network endpoints and exact volume reference sets are checked before/after faults. The Docker socket is available only to this explicitly owned controller; this is a destructive local qualification, not a public application endpoint.

1. An AFTER-member trigger verifies staged stock, audit, receipt and membership, then waits on the owned advisory blocker. Kill the exact web process; verify exit137/noOOM and a failed browser request with its Retry control intact. Let the blocker finish naturally, verify the original transaction is gone and all four ledger collections are empty, remove the test trigger, and restart the same server. Retry the original frozen request to save exactly one copy; replay adds nothing.
2. Hold a real successful second commit reply after the database contains two copies/receipts/members/audits. Kill/restart the same web, verify the durable ledger stays unchanged, then fail the held reply. The original frozen UI retry returns200/replay and adds nothing. A new third explicit addition works normally; the fourth card stays pending.

Both layouts verify unchanged source bytes/metadata, saved reviews, controlled job records, owner original access200 and unrelated user403. Each completed fixture cleanup must restore every public-table fingerprint (85 in this migrated schema). A stopped web, live blocker, active transaction or uncertain ownership preserves recovery records for explicit owner reconciliation; failed tests never silently reset the database.

The focused ownership tests reject foreign IDs/images/labels, namespace/storage/database changes, published ports, restart policies and missing/ambiguous process state. Full immutable IDs and separate role images are required.

## Current evidence

Qualification is in progress. Results, source/image/harness binding, any failed attempts and exact resource retirement must be recorded here before review readiness. This test does not authorize a merge, deployment, production operation or historical-record repair, and does not complete broad #310/#302, native/optical accuracy, Windows/agent/worker, host/power/storage-loss or user acceptance.