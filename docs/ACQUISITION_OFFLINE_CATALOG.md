# Offline catalogue family coverage

The explicit local catalogue importer prepares a derived printing-family index
after the verified bulk import completes. `Card` remains the card catalogue;
the existing public `AcquisitionCatalogLookup` cache holds source and family
membership metadata. This adds no database table or migration.

The first supported source is Scryfall's Default Cards JSONL gzip dataset.
Only English paper records establish local family coverage. Foreign-only and
digital records can remain in `Card` without establishing English paper
coverage. This is a dated snapshot, not proof of all-language or current live
Scryfall completeness.

## Publication and recovery

The builder verifies the compressed source digest and byte count before
consuming records from that same private file descriptor. It stages source,
generation, exact full-name/face aliases and set/collector locators in bounded
administrator-authorized transactions. Each batch publishes its membership and
durable cursor together. A failed transaction leaves neither partial membership
nor an advanced cursor.

Readers use a generation only after every expected unique source record has
been consumed and the manifest is verified and READY. Interruption leaves the
generation unpublished. Repeating the same import resumes its durable cursor;
concurrent resumptions serialize their batches and can replay already committed
prefixes from the same verified source. Existing COMPLETE imports gain the
derived index when the explicit local importer is rerun with their source.

## Lookup behavior

Known exact names, full names and face aliases preserve punctuation. Exact
printing requests preserve collector suffixes and List prefixes while accepting
ordinary collector zero padding. Every member is reread in one consistent
database transaction and checked against its source identity. A missing or
semantically changed member invalidates the entire family rather than creating
false uniqueness.

Price changes do not alter physical printing identity. Building or reading the
index never updates `Card`, Inventory or audit records. Stable local card IDs,
newer prices and existing foreign keys are preserved.

A valid fresh provider-enumerated family retains precedence. A verified local
family can satisfy a cold lookup or supersede an older negative/provider-error
cache entry without an external request. Ordinary recognition prefers the
complete dated English snapshot: an uncovered, fuzzy, foreign or changed lookup
remains explicitly incomplete and review-only, without an external request.
It never proves that a card does not exist. Feedback names the saved catalogue
and date instead of claiming that a live provider failed.

Explicit positive-only lookup callers retain their online fallback, including
new-card admission, foreign and fuzzy lookup. Unverified or incomplete catalogue
sources also retain the existing provider path, shared cooldown, negative cache
and fenced leases. An older provider error remains in
its cache/history when a snapshot-only request uses incomplete local evidence.

Successful local lookup evidence records the source digest, date, format version
and English language scope. Review feedback retains that evidence and displays
the saved catalogue date and English paper scope. Ordinary name-only, stamp, language, weak-evidence,
human-review and explicit Inventory-commit safeguards still apply.

Automatic confirmation also requires that the specific printing belongs to a
checked lookup result. English snapshot coverage cannot authorize a French
batch-language projection or a newer local printing outside snapshot membership.
Those suggestions remain available for manual review. A foreign printing that
receives its own checked provider result keeps its existing confirmation path.

## Evidence limits

Pure invariant checks and the real PostgreSQL verifier cover staged publication,
injected rollback, interruption/concurrent resume, aliases, languages, punctuation,
changed/missing members, price/ID/Inventory preservation and existing provider
cache controls. Full-source and affected native/browser checks are tracked
separately. These tests do not establish held-out recognition accuracy, physical
scanner behavior, production deployment or completion of the broader offline
upload-to-Inventory lifecycle.
