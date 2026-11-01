# Preserve concurrent Card metadata during acquisition lookup

An acquisition provider lookup reads existing Card metadata before publishing
its result. Its old unconditional upsert could wait for a concurrent writer,
then overwrite that writer's newly committed metadata. The same race existed
when a direct fetch inserted a Card after the lookup saw no local row.

The cache writer now conditionally updates an existing Card using its observed
fingerprint and the original lookup time. A changed row or a newer fetch wins
without receiving the delayed lookup's metadata or prices. Missing Cards use
an insertion that skips conflicts, preserving a concurrent insertion's identity
and metadata. Successful updates retain the atomic Scryfall/MTGJSON price merge.
Card writes and cache publication remain in the existing leased transaction.

`verify-acquisition-catalog-freshness.ts` runs three real PostgreSQL overlap
cases in the acquisition integrity suite. Each observes the lookup waiting on
the concurrent writer before releasing it. The complete winning Card, stable
mapping and first-cache time, seven physical copies and audit count remain
unchanged. Warm cache results use the preserved current Card metadata. The
first in-flight response retains its existing provider-result semantics.

This is a partial data-integrity repair under #307/#302, stacked on the separate
price-preservation change. It does not establish optical accuracy, full scanner
load acceptance, deployment or independent user acceptance.
