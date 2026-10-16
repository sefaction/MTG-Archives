# Printing worker fatal-stop evidence

Related [#791](https://github.com/sefaction/MTG-Archives/issues/791), [#755](https://github.com/sefaction/MTG-Archives/issues/755) and [PR #792](https://github.com/sefaction/MTG-Archives/pull/792). The October 14 05:30 correlated printing exit and primary restarts remain unexplained. This batch repairs the generic printing fatal diagnostic boundary; controlled failures do not diagnose that event.

## Behavior

Fatal printing errors retain a fixed execution phase, monotonic elapsed and phase milliseconds, bounded public exception type/code and locally trusted native termination detail. Private exception messages, stacks, queries, credentials and image observations are excluded. The existing public exception classifier is reused without exposing OCR-specific snapshot evidence. Native and database shutdown failures are separately recorded; database disconnect is attempted even when native shutdown fails. This prevents raw unhandled shutdown exceptions and skipped teardown. Fatal errors still set exit status 1.

Generation publication/refresh fallback, 30-second refresh and describe timeout, job timeout 120 seconds, lease 180 seconds, 100/1000ms waits, native preparation and processing authority remain unchanged. No retries, resource limits, native algorithms/models, retained originals, 64 decimal GB/owner or 2% controls change.

## Scoped author qualification

Code c35d1678e47e2c538efc81777c456bff46c14bf8 passes 20 actual-entrypoint/classifier controls, one existing generation publication/fallback control and typecheck. All three required checks pass in [run 38528467597](https://github.com/sefaction/MTG-Archives/actions/runs/38528467597). Actual entrypoint controls cover admission, processing, refresh, generation/idle waits, privilege refusal, trusted native stops and separate/combined cleanup failures. The normal once case preserves the existing handler, generation digest and 120000/180000ms job policy. No private error payload enters the records.

A real Linux candidate entrypoint with the unchanged printing descriptor and a synthetic unreachable database exits 1 at ADMISSION, classified DATABASE/PrismaClientInitializationError with no public database code. The exact temporary probe namespace was removed. Initial P1001 and mistyped-model assertion expectations failed and are retained; the observed code-less error is not rewritten as P1001. No database writes occurred.

The cumulative application and visual/printing images were built serially with the required scanner installer. The actual loaded application has 623 inputs, digest 027f5351d833bd6537de24b5e814f9b434967333fe6e1e0cdaea684e41b9426f. Only the new diagnostic library and printing entrypoint differ from the prior application build. All 329 copied printing libraries/scripts match the cumulative source; all 16 native Python/evaluation inputs match the unchanged visual runtime. Application image b94d1750a054f4abdec110a0ce385390fb58fc3e175f37edc4f022845e538c93 and printing image 51ff0426415522048bb838184999f92fa0c206566b8ff38b30632e494955c3a8 are loaded locally.

Actually loaded ordinary empty-once exits 0; the bounded unreachable-database case exits 1 with the expected private ADMISSION/DATABASE record. Printing readiness retains model 1e4d8b09d80c2b467160857111424577d9348059205ec60105955c752869ae52. OCR image/model/catalogue remain unchanged, with 109290 paper cards. Local login HTTP returns 200. These cases do not perform image inference or establish native throughput/independent accuracy.

## Conservation and retained failed comparisons

All 16 primary identities, images, full configuration, storage and lifetime fingerprints are unchanged, including three intentionally inactive services. The three untouched review roles (OCR, visual and PostgreSQL) retain their full fingerprints/lifetimes. All seven review roles are available with preserved resource/storage fingerprints. Only four authorized image-pointer fields changed; the rest of both compose documents were checked unchanged. Review jobs, capture, sessions, Inventory and correction examples remain zero. Catalogue 118503 rows/109290 paper projection and all 157 existing acquisition/correction original byte manifests are exact.

The initial aggregate configuration comparison for the four recreated review roles FAILED. Normalizing the proven generated hostname alone did not recover that before-only fingerprint. The original failure remains unqualified and is not silently accepted. A bounded same-image recreation with fresh per-field hashes separately passes exact images, resources, mounts and canonical configuration; observed differences are generated hostname and, for the three Node roles, ordering of unique-key environment entries. This does not retrospectively explain every difference in the earlier aggregate.

Current environment values and User/WorkingDir/Cmd/Entrypoint independently match unchanged literal compose inputs and identical old/new image configuration, using hashes only. Helper assumptions about absent/null image commands, default empty User and custom-entrypoint clearing of image Cmd failed before correction; no environment assertions were weakened or values exposed. This current verification qualifies the scoped diagnostics environment while retaining the earlier aggregate limitation. Future conservation probes should save per-field hashes and canonical unique-key environment projections before recreation.

An interruption crossed the earlier run's wall-clock budget. Its completed builds/probes, failed comparison and exact next step were checkpointed, the owned lock released, and this same batch resumed under a fresh heartbeat lock. No duplicate build or new source batch was started. The one additional same-image recreation was bounded to resolving the failed audit, with unchanged images/data.

Private evidence stays under the feature worktree's ignored .local-data/printing-qualification directory. The separate reviewer owns readiness, individual approval and merge; keep #791/#755 open for their unknown historical causes. No production, physical feed, independent accuracy or broad historical conservation claim follows.
