# Prisma pool investigation (#846)

Historical 87 web connections out of 100 do not identify a leak or a safe new
limit. This batch measures unchanged application source first. No connection,
timeout, database limit, worker topology or application lifetime policy changes.

`scripts/ci/prisma-pool.cjs` requires standard GitHub-hosted Linux, a local Unix
Docker daemon and no inherited database configuration. It builds the canonical
Dockerfile with the supported Buildx resource flags used by the prior hosted
review qualification. It creates an internal private bridge and disposable
PostgreSQL 16 with default 100 slots, synthetic credentials and tmpfs data.

One compiled Next server runs at a time. Thirteen fixed authenticated ordinary
page/API reads repeat three times, plus four concurrent list reads in each cycle.
The first lifetime has no preload; the second adds constructor observation
without modifying options, methods, queries or lifetime. Safe process/client
counts and caller hashes exclude stack text, URLs, tokens and user records.
Fixture setup, pool probe and HTTP drivers clear the preload. A short-lived
independent client reports the native engine default capacity with info logging,
then disconnects before sampling. Web pool URL parameters remain unset.

Samples group actual PostgreSQL client backends by state and the immutable web
container IP. Idle connections alone do not prove leakage. Repeated constructor
events, growing settled counts, bounded warm-up growth and per-client capacity
must be assessed separately. Artifacts bind source/tree/image, compiled server
hashes, constructor-bearing chunks, process identity, pool probe, HTTP statuses,
samples, failures and exact-owned cleanup. Cleanup verifies IDs/labels/network
peer membership before removing only disposable resources; no global prune,
installation access, backend termination or production data is involved.

This bounds ordinary empty-collection navigation, not original CPU topology,
scale, processing or historical workload. A passing run cannot close #846.
Any correction requires a demonstrated unchanged-source failure control,
regressions and independent review. All failed attempts remain evidence; local
heavy builds/runtime tests stay paused.
