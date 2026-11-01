# Exact printing names and search collisions

Scryfall's [paper printing search for Rampant Growth](https://api.scryfall.com/cards/search?q=%21%22Rampant%20Growth%22%20game%3Apaper%20lang%3Aen&unique=prints&order=set&include_extras=true&include_variations=true&include_multilingual=true) also returns the distinct card **Rampant, Growth**. The observed public response contains 49 printings, including one such collision. Previously, that different name made the whole enumeration fail with `INVALID_RESPONSE`, leaving valid Rampant Growth printings with unresolved coverage.

The provider now excludes punctuation-colliding names without treating them as the requested card. Exact names and exact matching faces remain eligible. Other unrelated names, invalid metadata, unexpected languages, digital results and duplicate identities still fail closed. All returned identities, including exclusions, count toward pagination totals and duplicate detection. The original paper printing must occur among the eligible results before coverage is checked. A digital named identity with no eligible paper result remains not found.

Cache query identities remain unchanged. Valid cached results and unrelated error backoffs remain reusable. Legacy invalid-response entries are rechecked once under the corrected enumeration version; newly checked invalid responses retain their normal backoff. Resolver v23 schedules the corrected interpretation for eligible retained observations, preserving human review and candidate fences. No schema migration is needed.

Verification:

- The unchanged provider passes 16 of 19 focused provider controls and fails the three intended collision cases. All 13 original controls remain unchanged. The corrected provider passes all 19; the broader affected provider/client/job/lineage/review selection passes 87 controls without failures or skips. Typecheck passes.
- One actual public response is fetched and then replayed through both versions. The unchanged source reports `PROVIDER_ERROR / INVALID_RESPONSE`; the corrected source reports `FOUND / CHECKED`, retaining 48 eligible printings and excluding the distinct collision. No scanner image or database is involved in this comparison.
- The existing disposable PostgreSQL cache verifier now checks legacy-error recovery, stable local Card IDs, current-error backoff and reuse of valid/network-error legacy caches. Exact-head CI must execute these controls before delivery is qualified.

This is a catalogue correctness fix under existing acquisition qualification work. It does not close the broader resource, independent accuracy or release trackers. Full native tests running on the earlier application source do not qualify this fix's application runtime. A subsequent source-bound local review step remains required; production deployment requires separate approval.
