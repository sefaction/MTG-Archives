# Local acquisition catalog maintenance

The first recognition path uses the existing `Card` table. This maintenance
batch adds an explicit, resumable **local operator import** of Scryfall's default
bulk metadata. It adds no per-photo external request, second card database,
scheduled production task or Inventory write.

## Source and progress

- Fetch the current [official default bulk metadata](https://api.scryfall.com/bulk-data/default_cards)
  and its `jsonl_download_uri` once for maintenance. The observed September 27
  format is gzip-compressed JSONL, with `compressed_size` in the metadata.
- Keep the downloaded source and metadata under ignored local storage. Preflight
  hashes the file, parses every record, counts rows and rejects duplicate IDs,
  malformed/truncated data and bounded-size violations before creating a job.
- `AcquisitionCatalogRefresh` binds the source digest, bytes, timestamp, expected
  row count and requesting admin to a durable cursor. Each 128-record CLI batch
  commits Card changes and cursor/counters together. A process interruption can
  resume using the same verified file and metadata.
- All writers of this import serialize a short batch with a transaction advisory
  lock. Replayed batch offsets do not repeat writes. Completion requires every
  expected row and a final file hash check; partial work never claims completion.
- The normalizer is shared with existing card import. Existing Card IDs,
  `mtgjsonUuid` values and referencing Inventory/Deck rows are preserved. A newer
  direct card fetch is protected by timestamp/fingerprint compare-and-swap.
- Missing top-level mana value on reversible cards remains null, while face
  metadata is retained. Collector suffixes, printed names and languages survive.

An import is incremental: partially imported Card records can exist if the job
is interrupted. A COMPLETE row describes one processed source, not an immutable
snapshot of every Card row or proof of all-language completeness. Recognition
must version its actual lookup index and retain explicit review.

## Local command

Provide the local snapshot's DATABASE_URL privately in the process environment.
The CLI refuses a non-loopback database or a missing local opt-in. The named
user must be an active administrator; permission is rechecked for every batch.
This command represents an explicit operator action in Admin Mode, not a public
endpoint where callers may supply an arbitrary admin identity.

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
npx tsx scripts/acquisition-catalog-import.ts --admin-user-id <local-admin-id> --file .local-data/acquisition-corpus/scryfall-default.jsonl.gz --metadata .local-data/acquisition-corpus/scryfall-default-metadata.json
```

Repeat the same command after interruption. Progress resumes from the durable
cursor. A completed digest returns without rewriting cards. An altered file
cannot be declared the same completed source. A different source digest creates
a new refresh record. Sources are not automatically deleted.

This first batch intentionally requires an operator command. An authenticated
admin UI/background schedule and source-download lifecycle are subsequent
integration work; no ongoing automatic refresh is claimed.

## Verification

`npm run verify:acquisition -- --core` uses a disposable PostgreSQL database.
The catalog cases exercise non-admin/Admin Mode rejection, concurrent create and
batch replay, failure after Card writes but before cursor commit, restart from
FAILED progress, incorrect digest/incomplete finalization, preserved existing
Inventory references and quantities, suffix/face/language data, missing mana
value, revoked admin access, and both prior and racing newer direct card data.
The file test rejects duplicate IDs, truncated gzip and oversized records while
preserving UTF-8. The full-source preflight accepted 118,404 records, including
82 without top-level mana value.

The initial full suite passed in local report
`acquisition-2026-09-27T16-06-38-982Z`; the final database rerun including the
reversible-card and direct-fetch race cases passed in
`acquisition-2026-09-27T16-10-44-126Z`. Full-size local import measurements and
the resulting Docker image are recorded in the work checkpoint/PR when complete.

## Full local catalog evidence (September 27)

The complete source imported in 446.208 seconds: 100,529 new cards, 17,260
updated cards and 615 preserved cards. The existing 17,953-card cache became
118,482 cards (older cards absent from the source were retained). All ten
Android development-corpus printing IDs are now present. Repeating the same
command returned the completed refresh without changing its cursor/timestamps.
The 10,275 Inventory rows, 12,477 copies, exact hash of all Inventory row fields,
and 10,731 audit rows remained unchanged. This measures the local snapshot only.

The expanded catalog exposed slow common-name searches (#450). Trigram indexes
cover case-insensitive name, set and Deck type matching; a collector-number
index covers exact matching. A shared query materializes matching IDs/name/date
before sorting and hydrates only the selected IDs through Prisma. Broad Deck
types use a separate ordered, bounded branch before union and final ordering;
"Creature" must not materialize most of the catalog. This prevents
an incremental-sort plan from fetching tens of thousands of wide rows first.
Matching and date ordering are retained, with ID added for deterministic ties.
League-scoped search keeps its existing ownership/location predicate.

The first index migration took 42.4 seconds including CLI startup on this local
snapshot. These ordinary index builds can block Card writes while building;
they are additive but should be deployed during a quiet period. No production
deployment or automatic maintenance schedule is enabled by this batch.

The final database search-parity fixture compares all query branches, type-line
mode, punctuation/wildcards and SQL-looking input against Prisma results,
including complete returned Card fields. It passed in local report
`acquisition-2026-09-27T16-35-27-859Z`, including the final bounded type branch.
An earlier timeout fixture run failed with
its one-second test lease during a concurrent Docker build; the handler-abort
case now uses a ten-second lease, while explicit-clock lease-expiry tests stay
separate. Final image/provenance and browser evidence are in the checkpoint/PR.

On the final local Docker image, a warm sample of Forest/Mountain/Anzrag/Creature
lookups took 25–98 ms for ordinary lookup and 21–69 ms with Deck type matching.
These are bounded local measurements, not a latency guarantee. The photo-intake
browser regression passed with all ten original Android images, 7.842 seconds
from upload to prepared images and no Inventory writes. It still performs image
preparation only; recognition/review/commit are subsequent integration work.
