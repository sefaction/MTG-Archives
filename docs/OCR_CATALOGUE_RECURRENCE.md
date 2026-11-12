# Catalogue failures during slow stage handoffs

Related to [#777](https://github.com/sefaction/MTG-Archives/issues/777).
This index addresses a measured local query bottleneck. It does not establish
the cause of the original uninstrumented OCR exit or every later failure.

## Natural recurrence

After the authorized November 11 main installation, a read-only lifecycle check
found 36 OCR-container restarts. The retained log contains 35 P2028 stops in
LOAD_CATALOG or REFRESH_CATALOG / READ_PAGE, near the existing 60-second
transaction deadline. The remaining stop is a separate DESCRIBE_MODEL native
timeout. Neither that timeout nor the older historical incidents is explained
by this index. No restart was induced to collect these failures.

Database activity also showed long-running printing handoffs. Their first
1,023 bytes match the current source-generated query fingerprint; the activity
view truncates longer queries. A separate bounded page-query check used the
Card primary-key index efficiently. That check did not reproduce a missing
catalogue pagination index, and no pagination algorithm was changed.

## Supported bottleneck and change

The printing handoff rejects a completed source when a newer job exists for
the same candidate, candidate revision and stage, ordered by `(createdAt, id)`.
The existing unique job index starts with artifactId, which this lookup does
not constrain. Repeating that lookup across accumulated histories can scan
substantial index ranges even when no work is eligible.

The additive index starts with candidateId, candidateRevision and stage,
followed by createdAt and id. It supports the existing newer-job range lookup
without changing its SQL, eligibility, permissions, manual-analysis fences,
owner/run fairness, latest-result rules, job identities or recognition output.
The original artifact-leading uniqueness constraint remains.

## Author comparison

The unchanged installation was copied once into an isolated PostgreSQL fixture
using the same immutable server image. The private custom archive checksum and
TOC were verified. Scalar planner statistics were collected in that copy;
restored planner state is not claimed identical to the live installation.
The fixture had no application workers or external network route.

The unchanged printing admission SELECT hit its declared 30-second statement
limit. Its failed result is retained. With the candidate index and default
planner settings, the same SELECT completed in about 173 ms; EXPLAIN ANALYZE
reported about 182 ms. The newer-job lookup used a bounded index-only scan.
Both a separate reference plan and the indexed query returned zero eligible
jobs in this snapshot. The reference disabled nested loops and JIT only in its
disposable read-only transaction; those are not application settings or a
proposed remedy. No successful default-planner baseline or nonempty-queue
equivalence is inferred from the empty-result comparison.

Private evidence stays under the repository's ignored
`.local-data/issue-closure-20261111/`: the source/model binding, natural failure
capsule, snapshot identity, original timeout, reference/default-index plans and
fixture resource manifest. It contains installation data and must not be
published. Snapshot hashing initially hit an unavailable Python API; streaming
hashing and archive verification completed without repeating the dump. Initial
resource-absence checks stopped before creation and were corrected separately.

## Migration, safety checks and local installation

Schema validation and normal Prisma migration deployment pass on the restored
database and a fresh database. The index build took 0.207 seconds in the copy.
All 44 focused source controls pass. Existing real-PostgreSQL checks also pass:
exact legacy snapshot identity/index, repeatable-read concurrent edit/delete/
insert isolation, failed-refresh preservation, four bounded positive handoffs,
first-result priority, four-owner fairness despite 40 busy-owner runs, reconnect,
stale/reviewed/excluded work rejection, live-lease preservation and zero Inventory
writes. Their disposable jobs/cards/Inventory namespaces finish empty.

A full catalogue load alongside eight normal idle printing polls completes in
10.071 seconds under the unchanged snapshot limits. It indexes 109,324 cards
and matches the retained installation catalogue digest. This is a bounded
post-index control, not a reproduced before/after OCR failure comparison.

The verified migration is applied to the laptop review installation. Its index
build took 1.498 seconds; all 10,293 Inventory rows, all original fields and
12,496 copies conserve. No application container identity, start time or restart
counter changed during migration, and no application service operation was
invoked. The temporary migrator and isolated fixture are retired; the protected
private snapshot remains. This is an unmerged local database review overlay,
alongside the separately identified compact-navigation preview.

OCR's restart count remained 36 and its current lifetime began before the index
was applied: availability had already recovered. Do not describe this index as
the cause of that recovery or as a validated covering explanation for P2028.
Required current-head CI and individual merge review remain separate.

Authenticated read-only Scan cards and Inventory navigation passes at desktop
1366 and phone widths 390/320, with no overflow or errors in the completed
check. An initial check selected both streamed loading/content main elements
and captured React hydration error418. Waiting for the actual page heading and
loading fallback to disappear fixes the ambiguous assertion; the later pass
does not explain the initial hydration error. Both records are retained as
navigation-review evidence, with no frontend change in this index batch.

Two additional harness failures are preserved. A 64-process checker cap blocked
the schema engine while DNS/TCP/database readiness still passed; the exact owned
idle checker was replaced with a 128-process checker inside the same 512 MiB
memory envelope. The existing concurrent snapshot-edit test requires two
connections; its inspection-only one-connection URL caused P2024. It passes
unchanged with two fixture connections. Application limits and pools were not
changed. The migration has a normal index-build write-lock window; use the
existing protected deployment process for any other installation.

The 60-second repeatable-read snapshot transaction and 10-second admission wait,
fatal-stop behavior, native deadlines, worker limits, job leases and previous
immutable snapshot reuse remain unchanged. Keep #777 open for uncovered
historical failures and any remaining affected-installation recurrence. A fast
handoff alone does not prove that every OCR transaction stays within budget.
Production inspection/deployment, optical accuracy, sustained-load acceptance,
full backup/restore and user acceptance are separate.
