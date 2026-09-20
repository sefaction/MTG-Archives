# Local inventory expression metadata (#224)

## Cause and change

The original candidate query hydrated complete related Card rows, including the full cached Scryfall documents, before evaluating local expressions. On the laptop snapshot, 7,308 distinct printings produced about 81 MB of JSON and multi-second reads. Querying Card through an inventory relation alone did not remove that payload cost.

The existing access-scoped inventory filter still selects candidate IDs. Metadata then loads in 500-card batches with SQL-bound IDs. Common expressions select only required evaluator columns and legacy JSON fallbacks; more complex expressions use the full evaluator metadata projection. Unrelated images, purchase links and other cached response fields are not requested. Raw JSON fallback keys are extracted in one pass, avoiding repeated decompression of a PostgreSQL TOAST value. The evaluator and final inventory scope are unchanged; there is no external Scryfall dependency or cached result/ownership list.

Maintain the metadata contract alongside evaluator changes. Type/name/oracle/mana fields must retain face fallbacks; normalized columns can be absent in older cached printings. Numeric card-to-card comparisons and less common fields deliberately use the conservative full projection.

## Verification

`scripts/verify-inventory-query-metadata.ts` is an opt-in read-only local snapshot check. In one repeatable-read transaction it compares full Card metadata and every generated projection against 59 expressions, including Boolean/regex, face-sensitive text, numeric comparisons, colors, legality, prices, raw-only metadata, and printing fields.

Run inside the local container:

```powershell
docker exec -e MTG_LOCAL_PILOT_TEST=1 mtg-archives-web-1 npx tsx scripts/verify-inventory-query-metadata.ts
```

One final development run on 7,308 printings: full metadata 81,473,528 bytes / 6,115 ms; conservative evaluator projection 23,664,478 bytes / 2,294 ms; type-expression projection 1,800,644 bytes / 764 ms. All 59 comparisons passed. These are individual warm/cold-sensitive laptop measurements, not controlled production guarantees. Earlier first-pass projection preserved results but did not materially improve latency; it was refined before claiming completion.

Unit coverage checks parameter binding, batch bounds, empty/invalid candidate handling, scope preservation, and conservative fallbacks. Full browser verification must include both existing private/public Scryfall tests with unchanged assertions; record results in the PR rather than loosening their timeouts.
