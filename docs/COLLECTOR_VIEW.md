# Collector view (#1010)

## Initial catalog choices

`/collector` reports the signed-in user's English paper collection, including physical copies committed to decks and reserved for trades. It does not move, reserve, export or edit inventory. Admin mode does not expand this endpoint to other owners. An unlinked account receives no inventory data.

These are explicit, reversible initial design choices, not Brian-confirmed preferences:

- Grouped completion uses Oracle identity within a Scryfall set, falling back to exact full name when absent. Printing/variant completion uses Scryfall printing ID plus supported nonfoil, foil or etched finish.
- English paper catalog and English inventory copies only. Promos, alternate art, special treatments, reversible cards, supplemental non-token card types and memorabilia sets are included in their Scryfall-assigned sets. Serialized numbers are not separate targets. Condition and duplicate quantities do not increase completion.
- Tokens (including double-faced tokens), emblems, art-series cards, helper `Card` types, oversized and digital printings are excluded. An owned printing/finish must exist in the eligible complete catalog to contribute.
- Grouped mode and only sets with English inventory are initial defaults. The latter is a directory filter, not a claim that a set has eligible owned cards; token-only or excluded inventory can show zero. Sort is newest first. Search and all-set browsing are available. Twelve tiles per page load through three browser requests at once.

## Denominator and privacy

Public Scryfall metadata uses the existing throttled/retrying client. Every page is requested with locally constructed parameters; provider `next_page` URLs are ignored. Stable advertised totals, unique printing identities, expected set/language/paper scope and valid metadata are required. A failure, missing page, changed count or 100-page/20,000-printing bound never publishes partial totals or percentages. A verified catalog may be reused for 24 hours; its check date is displayed. This is a catalog snapshot, not a claim of eternal completeness.

Public metadata cache is bounded to 64 sets / 30,000 printing records. Three server loads run concurrently with a maximum 24 queued requests and a 90-second lifetime. Shared subscriptions deduplicate the same set. Navigation cancellation removes its subscription and cancels provider work when no callers remain. No inventory results are shared in that cache. Private API responses are `private, no-store`, and owner scope always comes from the authenticated account. The directory can fall back to locally known owned sets, prominently marked, without using local cards as a denominator.

## Verification

- `npx tsx --test tests/collector.test.ts`: 14 focused cases passed, including catalog completeness, token invariance, owner/language/finish rules, duplicate copies, multi-face/reversible/supplemental cards, memorabilia directories, navigation cancellation, shared subscriptions and 150,000-copy arithmetic.
- Full TypeScript passed in an isolated Linux container after exact-lockfile dependencies and Prisma generation. Earlier host attempt hit a deliberately bounded 1400 MiB heap; initial image dependencies were stale and rejected unrelated current-main Prisma fields. Neither failure was hidden or treated as a code pass.
- Live Scryfall enumeration passed: WAR 275 printings / 265 grouped cards / 539 variants; CED 302 / 292 / 302; SLD 2844 / 1799 / 4485 across 17 pages. These are metadata checks, not a database-scale benchmark.
- Production build passed, including lint/types, static generation, traces and client-manifest verification. The first build correctly caught a synchronous effect-state reset; the reset was moved into the Retry event and the full build rerun without disabling the rule. The unrelated existing InventoryBrowser ref-cleanup warning remains.
- Combined Collector/Scryfall/auth regression coverage passed 35/35.
- Real PostgreSQL passed deck-only ownership, reserved copies, peer separation, token exclusion and 85-table equality before/after reads and complete fixture rollback. The verifier is added to the existing import-integrity CI job.
- Desktop 1366px and phone 390px plus API privacy passed 3/3 browser cases. Covered both completion modes, counts, no horizontal overflow, 12-tile pagination, search, incomplete-catalog retry with no percentage, Back navigation, anonymous401, unlinked403, invalid-set400 and ignored owner spoofing. The first phone Back test raced an unfinished inventory navigation; the failed trace is retained, and the corrected test waits for that URL before Back with all original product assertions preserved. Screenshots were visually inspected.
- Exact-head CI, publication and regular-local installation remain pending until recorded below. Isolated review uses only synthetic accounts/data and controlled provider responses, not the user's existing collection.

`verify-collector.ts` accepts only the named disposable Collector or existing CI import-integrity database and rolls back its synthetic fixtures after comparing all public tables. `collector-ui-fixture.ts`, `collector-ui-provider.cjs` and `tests/ui/collector.spec.ts` use a separate disposable installation, controlled public catalog responses and synthetic accounts. Run browser cases only with `MTG_COLLECTOR_UI=1`; the normal test suite skips this explicit fixture. Controlled UI/provider evidence is separate from the live Scryfall enumeration above.

No production deployment, merge or user acceptance is implied. The main checkout's unrelated policy/manual work and the regular app's data/workers remain untouched by isolated qualification.
