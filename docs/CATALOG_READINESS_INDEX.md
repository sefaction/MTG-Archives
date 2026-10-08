# Catalog readiness source index

Issue #668 tracks slow ready-job selection as catalog evidence accumulates. The migration adds an expression index on processing stage, stored recognition source ID and resolver version. The readiness selector and its eligibility, ownership, fairness, manual-analysis guards, resolver windows and admission behavior are unchanged.

The existing catalog selector compares JSON source references before deciding whether stored results suppress another handoff. Indexing those references lets PostgreSQL find matching evidence without repeatedly scanning unrelated catalog outputs. This index also supports a stage prefix; it does not depend on a single resolver constant or remove historical jobs.

## Regression coverage

The disposable acquisition PostgreSQL verifier exercises the actual selector with 4096 unrelated synthetic catalog outputs containing distinct complete evidence. It checks identical ordered ready sources, use of the indexed source condition, matching unreadable and pending suppression, expired/recent resolved windows, and obsolete resolver eligibility. Source/candidate/Inventory state is conserved; the exact synthetic namespace is cleaned in finally. Existing concurrent admission, lease, fairness, manual-boundary and retired-parent checks still run.

The verification fixture also accounts for both observed Windows/Prisma and database clocks. An immediate createMany can bind availability from the client clock; database-only fixture time can therefore be too early. Controlled older-database-clock checks preserve genuinely future availability and claim a newly eligible job without retries, sleeps or job-derived clock advancement. Production claim/CAS policy is unchanged. This explains the reproduced verification miss, not every historical #498 observation.

Run npm run verify:acquisition for persisted coverage and npm run verify:core for generation, typechecking, unit tests and the production build. Full-evidence isolated local profiling supports the change; private plans and database details remain ignored local evidence. A timed-out unindexed profile does not supply an ordered result for comparison; the synthetic regression supplies that equality check.

## Delivery

The ordinary Prisma migration creates a normal index, following existing expression-index migrations. Creation uses PostgreSQL's usual index-build write lock; production application belongs in the operator's migration window. No production migration has been performed by this batch. The migration refreshes expression statistics immediately with ANALYZE; PostgreSQL otherwise needs an analyze pass before it can cost a new expression index accurately. See [PostgreSQL16 CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html). The index changes neither stored rows nor Prisma's application data shape.

A rollback can remove only AcquisitionProcessingJob_source_reference_idx after the usual migration bookkeeping is reconciled; source records do not require rewriting. No physical scanner acceptance or historical worker/claim root cause is established. Broader issues463/498/579 and production acceptance565 remain separate.
