# Interrupted pricing source recovery qualification

Related to #854 and parent recovery concerns #851, #755 and #305. This test-only batch exercises the existing summary rebuild command. It does not change worker/import behavior or close the broader incident.

## Representative failure and recovery

Source c59d01ed1455edadb0010555fb0307cb2eedd87d adds `scripts/verify-pricing-interrupted-import.ts` and runs it in the required PostgreSQL import-integrity job. The verifier creates a uniquely named disposable database after explicit local/CI opt-in. It never operates on the configured database's existing tables, calls a provider, or reads private card/image data.

The fixture starts with 153 observations across 51 printings, then commits an existing-ID price correction and a 50-observation prefix of another import. Two planned observations remain absent. This represents durable partial writes before summary/job completion; it does not reproduce a real worker crash or PostgreSQL ENOMEM.

Before recovery, the stored ready flag remains true while source maximum-ID/revision coverage is stale. The existing-ID correction independently demonstrates why matching maximum IDs alone is insufficient. A deliberate summary-write rejection makes the real rebuild command fail and leave readiness false, with source and historical job/run/log rows unchanged. Removing that fixture-only rejection allows the existing command to rebuild all five projections:

- 203 daily rows with exact source IDs and correction revisions;
- 51 current/prior scope summaries;
- 203 monthly, 203 weekly and 102 yearly rows, checked against observation-derived dates, prices and counts.

A repeated rebuild preserves semantic projection content and exact raw IDs, prices, revisions, ingest times, raw JSON and seeded job/run/log history. All three interrupted jobs remain RUNNING with their original zero counters: rebuilding available source cannot establish that a complete provider feed or app-card projection was delivered.

## Local checks and delivery

The final representative fixture passes on PostgreSQL 16 and Node 22.23.1 in owned disposable containers, with the four actual current verifier/rebuild/schema/upsert inputs mounted read-only. The PostgreSQL role is bounded to 256 MiB/one CPU; the check role to 512 MiB/one CPU. Both use 128-PID limits. Configured limits and a short successful run are not peak-memory or sustained-load qualification.

Three preflight controls reject missing opt-in, missing connection and remote hosts. Two private, disposable command mutations are rejected at the intended assertions: deleting a printing's yearly summaries, and rewriting interrupted jobs as successful. Normal and negative checks remove their generated databases, containers, anonymous volumes and networks. All 24 pre-existing primary/review container identities, images, settings and lifetimes and six native event-counter sets are conserved during each fixture interval.

Initial fixture quoting/transform and duplicate result-key typecheck failures are retained; both were corrected before the passing final fixture. The previous shared delta/projection query's eight-second timeout remains failed and was not rerun or increased. Private run evidence is `.local-data/issue-worker/runs/acd866c3-80b0-432f-b906-dbeced32173c`.

Cumulative delivery adds verification sources and this report to the existing review checkout. Application/worker images remain at the separately qualified #850/#853 sources; this test-only change needs no image rebuild or unrelated browser/native rerun. The new check itself runs against the owned local Docker fixture. Exact feature/cumulative commits and current-head CI belong in the PR and worker checkpoint.

## Remaining acceptance

The local PostgreSQL WAL-write ENOMEM trigger, actual interrupted-import reconciliation, shared summary catch-up, full-history integrity, concurrent-writer fencing and app-card projection recovery remain unqualified under #854. This seeded 203-row test does not justify replaying historical jobs or running an unfenced full rebuild against a live writer. First qualify an isolated local snapshot and exclusive-writer preconditions before selecting a shared recovery action. Capture contemporaneous child/write-error and host/guest/bind evidence during an otherwise justified failed workload; clean idle cycles do not explain its cause.
