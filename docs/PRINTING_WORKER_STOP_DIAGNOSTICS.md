# Printing worker fatal-stop evidence

Related #791 and #755. The October 14 05:30 correlated printing exit and primary restarts remain unexplained. This batch repairs the generic printing fatal diagnostic boundary; controlled failures do not diagnose that event.

Fatal printing errors retain a fixed execution phase, monotonic elapsed and phase milliseconds, bounded public exception type/code and locally trusted native termination detail. All private exception messages, stacks, queries, credentials and image observations are excluded. The established public exception classifier is reused without exposing OCR-specific snapshot evidence. Native and database shutdown failures are separately recorded; database disconnect is attempted even when native shutdown fails, preventing raw unhandled shutdown exceptions and omitted teardown. Fatal errors still set exit status 1.

Generation publication/refresh fallback, 30-second refresh, 30-second describe timeout, job timeout 120 seconds, lease 180 seconds, 100/1000ms waits, native preparation and processing authority remain unchanged. No retries, limits, model/native algorithms, retained originals, 64 decimal GB/owner or 2% controls change.

Qualification pending: actual entrypoint failure/normal/fallback/shutdown controls, types, exact-head required CI and cumulative local printing image/startup/controlled probe with source and data conservation. No production, physical feed, independent accuracy, sustained throughput or historical cause is claimed.

Initial qualification: 20 actual-entrypoint/classifier controls and types pass. Actual Linux candidate entrypoint with the unchanged printing descriptor and a synthetic unreachable database exits 1 at ADMISSION with code-less PrismaClientInitializationError/DATABASE. Initial P1001 and mistyped-model assertion expectations failed and are retained; corrected bounded public classification matches observed code-less behavior. Exact-owned temporary probe namespace removed; no database writes. CI and cumulative image qualification remain pending.
