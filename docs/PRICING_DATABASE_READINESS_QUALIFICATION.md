# Pricing database readiness qualification

Related to [#851](https://github.com/sefaction/MTG-Archives/issues/851) and [PR #853](https://github.com/sefaction/MTG-Archives/pull/853). October 18, 2026 (October 19 UTC).

## Diagnosis and repair

The pricing PostgreSQL log records a WAL-write ENOMEM PANIC at 00:03:21 UTC, an aborted server child, recovery, and readiness at 00:04:58. The pricing worker's matching connection errors establish why it repeatedly exited during recovery. Why the database write returned ENOMEM and reconciliation of the interrupted import remain separately tracked in [#854](https://github.com/sefaction/MTG-Archives/issues/854). Current zero cgroup events and Docker OOM=false do not explain the historical failure.

Source2547386 changes only an import and two pre-work calls in the worker, plus a new helper. The original worker source is exactly restored after removing those additions; SQL, scheduler, claims, writes, imports and error handling remain byte-identical. The helper waits at most180 seconds before initialization and before each polling cycle, using bounded pg_isready probes and increasing delays capped at10 seconds. Rejection/no-response wait; invalid command/configuration failures propagate. Quiet command output and safe wait/ready events do not publish connection strings or credentials. PostgreSQL readiness is distinct from successful authentication; subsequent permission/SQL errors still fail normally. See [PostgreSQL16 pg_isready documentation](https://www.postgresql.org/docs/16/app-pg-isready.html).

No SQL write or in-flight job is replayed. A failure after the readiness check can still terminate that attempt; startup then waits rather than repeatedly crashing during the same short outage. This does not implement general import recovery or fix the underlying database/storage failure.

## Evidence

-18 focused readiness/platform/MTGJSON tests and typecheck pass. Controlled rejection/no-response/success, bounded expiry, fatal probe errors, immediate-ready behavior and private diagnostic exclusion are covered.
- Real disposable PostgreSQL: installed legacy pricing source exits while the server is unavailable; fixed source remains alive, waits for startup and completes one cycle. A ready server's permission failure remains fatal without SQL retry. An idle-cycle outage and restart preserves the fixed process and container lifetime, then subsequent cycles succeed.
- An owned queued import, local synthetic HTTP feed and separate tiny app database produce exactly one price snapshot1.23 and successful job counters after database unavailability. The first fixture lacked an app target and imported zero; its failed evidence is retained. Corrected explicit target and final TCP listener readiness establish the passing test, without external provider calls.
- The installed original image is no longer locally resolvable. An available base has identical seven pricing source files and Node22.23.1. The installed package.json is copied exactly, and all60 tsx/esbuild executor files match. Old/control and candidate use that same base. This establishes the relevant pricing execution closure, not equivalence of unrelated web/scanner files. The final image changes only the worker, helper and truthful overlay metadata beyond the available base/package layer. Candidate image03770b334ef3fb44a640818c7b9d859527b6ecbe3852880cf8a5e9fa40faf77d is bound to actual source hashes. No application image compilation was needed.

## Local publication

Only the primary local pricing-worker role was replaced. Existing environment values are compared in memory; only hashes are retained. Existing configuration files are reused with an image-only override plus explicit original one-second stop grace and json-file logging defaults. The first publication exposed changed Docker/Compose defaults for those two settings; failed guards are retained and the original settings were restored before qualification. Three deliberate targeted recreations occurred; they are not uninterrupted-lifetime evidence. No other service was recreated.

The final worker52e4e7fc has the verified source, unchanged environment/mounts/host settings and three successive successful cycles at initial observation, no failed cycles or restart, database ready, and unchanged pricing job metadata fingerprint. Remaining primary and review service identities/settings/lifetimes are conserved. The original #850 failed interval remains FAILED; its resumption receives a fresh baseline after this intentional repair.

A proposed full container-configuration dump was rejected by automatic approval review because it could copy credentials. It was not executed. The safe publication method writes no credential values; existing configuration is reused and only hashes are saved.

## Limits and retained attempts

No natural host-memory exhaustion was reproduced. No historical or stale import was reset/replayed, source history deleted, resource limit changed or production touched. Existing three RUNNING jobs, including the interrupted October19 import, remain under #854. This is bounded readiness/continuity evidence, not sustained-resource or complete database-recovery acceptance. The underlying trigger can recur.

Private harness failures (line-ending patch, unavailable image address, package comparison, module path, temporary initialization-listener race and source-scope indentation removal) remain in the local qualification evidence; none is a passing product claim. Repository source and final exact-head CI are recorded in the PR/checkpoint. Separate reviewer owns readiness, individual approval/merge and closure.
