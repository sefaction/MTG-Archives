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

Independent source review of `f8c3f42b` found no blocking target, egress or cleanup
issue. The observer intercepts the default `require('@prisma/client')` entrypoint;
it does not cover arbitrary generated-runtime entrypoints. Route-boundary samples
do not measure transient peaks. The separate native capacity probe does not
directly inspect each web client's capacity. Both phases share a disposable
database and ordinary GET side effects; initial datasets are not strictly equal.
The canonical image source and compiled hashes bind this bounded experiment,
not original production source/runtime identity or a covering historical cause.

## Measured outcome

[Hosted run 39529697814](https://github.com/sefaction/MTG-Archives/actions/runs/39529697814)
on exact `f8c3f42b970109914d3b1886a10f1677a301f4b2` completed both lifetimes and
owned cleanup. All 102 ordinary HTTP reads returned 200. Each lifetime started
with zero measured web connections, warmed to five on the first dashboard read,
then stayed at five idle connections through all 39 route reads, three four-read
bursts and the final sample. Each web process kept the same PID with no restart.
The observed process constructed two clients during startup, before the first
database sample; no later constructors appeared. These are construction counts,
not a measurement of two live pools or leaks. The separate default-pool probe
reported capacity five despite container available parallelism one and four
visible logical CPUs. The actual production CPU topology remains unmeasured.

The image ran Next 15.5.25 and Prisma 6.19.3, matching the historical release lock.
The unchanged Prisma blob is `9edc9c3ba31c7e1547d729f340305fc5e988c990`.
Forty-seven compiled files contain constructor expressions; two constructions
were observed in the web process. Compiled expression count therefore does not
measure live clients. The image was
`sha256:0edf8cc191705fba8ccbf1635df89e4730cc7e4ed24b2368a5823047fd667651`.
All three standard Verify gates also passed on that exact head.

Independent review requested stronger source/image assertions, immutable database
image selection, enforced observer tests and cleanup after failed diagnostics.
The follow-up implements those guards, retains native Buildx resource history
and the in-image source manifest, and records safe compiled module callsites.
Three focused tests cover observer preservation/privacy and failure-independent
cleanup. Final hosted checks are attached to the PR; do not reuse old-head status.
No production correction is supported by this measurement. #846 remains open;
next evidence should bind the original native pool/CPU/process topology and a
fixed representative populated workload, then test any covering hypothesis in
an isolated target before changing lifetime or pool policy. No production probe
or runtime change is authorized by this recommendation.
