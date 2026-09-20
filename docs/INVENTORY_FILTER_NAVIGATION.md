# Advanced-filter navigation audit (#220)

## Reproduction and decision

On the released Docker build (`9a3fd8b`, Next.js 15.5.19), the serial color-filter test failed once in 10 mixed repetitions, then twice in 20 instrumented repetitions. Ten isolated exact-color runs passed. One captured failing RSC response finished HTTP 200 in 39.5 ms, while the old URL and filter chips remained unchanged for the entire 10-second assertion window. No failed static chunks or console/page errors were present in that capture. Blocking background prefetch requests still produced one failure in 20 mixed repetitions.

This establishes a client-side transition failure in the observed case, not a slow filtered database query. It does **not** establish the exact internal React/Next.js mechanism. Database and page-scale work remain independent concerns.

Advanced search now performs a normal document GET using the same serialized query. The shared private/public component retains page-size and other hidden context, repeated filter values, page reset, and saved scroll/panel state. Browser Back can return to the previous search. The deliberate tradeoff is a full document navigation when applying advanced filters; other router navigation is unchanged. No framework upgrade, timeout inflation, prefetch suppression, or database tuning is included.

## Reproduction commands

With the local production Docker stack healthy and no build running:

```powershell
npx.cmd playwright test tests/ui/inventory-color-filter.spec.ts --repeat-each=10
$env:MTG_LOCAL_PILOT_TEST='1'; npm.cmd run verify
```

The browser test checks that submission is a document GET, validates both repeated colors and filter chips, preserves page size and the expanded panel, and exercises Back/Forward. The full suite also covers public/private Scryfall arguments. Exact validation and deployment evidence are recorded in `LOCAL_REVIEW_BUILD.md` and the resolving PR. Local diagnostic traces remain ignored under `test-results/`; do not upload raw authenticated traces as public attachments.
