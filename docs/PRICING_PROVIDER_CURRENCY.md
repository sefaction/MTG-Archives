# MTGJSON provider currency and market parsing

Issue #863 was reproduced while qualifying a pinned current feed for the separate #854 recovery investigation. MTGJSON PriceList declares `currency` beside `buylist` and `retail`; it is not normally a currency-named path. The old parser ignored that declaration. It also recognized `paper`/legacy `online` but treated the real `mtgo` market as a provider.

The parser now carries a valid declared currency only down that provider branch, normalizes its three-letter code, preserves explicit currency-path precedence and uses the configured fallback when no valid declaration exists. It recognizes `mtgo` and preserves legacy `online`. Amounts, dates, source paths, card filtering and import caps are unchanged. No currency conversion is performed.

## Evidence

An independent traversal of the pinned 2026-10-18 AllPricesToday entity (112,963 card entries, SHA256 `612ea899826efcf0d43c00209cd5d2accc49e8bbb22850b8c5e129600db01376`) selects 49,028 observations for 5,706 of a dated local snapshot's 5,735 mapped cards. It reads each provider's declared currency and actual market/provider structure without using the parser's helpers. The old parser mislabels 10,096 EUR observations and 4,838 MTGO provider observations. The fixed parser matches all fields, with 38,932 USD and 10,096 EUR observations. This is not an atomic current cross-database snapshot or proof of the original interrupted feed.

Nine parser/selector tests include actual feed shape, currency ordering and branch isolation, explicit-path precedence, configured fallback, malformed declarations, finite values, unchanged input/raw paths and existing filters/caps.

`scripts/verify-pricing-provider-currency.ts` runs the real worker against owned local/CI PostgreSQL databases and a loopback-only feed. Old code fails the expected raw-row assertion. Fixed code preserves provider/currency through raw observations, daily/current scope summaries and app JSON, updates a same-day EUR correction, and preserves other price sources and an outside-feed card. Two feed requests produce five distinct raw keys; the verifier removes its owned databases even on failure. Conflicting inherited libpq endpoint/service values are stripped. Required import-integrity CI invokes this verifier.

The private run `2717104a-a3cb-457f-a2b9-adc54da67e65` retains the original audit mistakes (omitted MTGO market and assumed market order), an initial CRLF-sensitive edit failure, and their corrected independent results. These failed attempts are not product acceptance passes. Exact Git/CI and actual local component image/settings/source/data proofs belong to the PR and resumable worker checkpoint.

## Delivery and remaining scope

Only the executable Pricing worker consumes this parser at runtime. Local delivery overlays the parser on the existing qualified pricing image, preserving its #853 readiness and #858 maintenance components and all settings. The ordinary web/native review images do not need a Next rebuild for this worker-only change. Preserve their existing qualification rather than claiming a new whole-application source identity.

This prevents new imports from creating incorrectly keyed observations. Previously mislabelled USD or `mtgo` historical keys remain; this change neither deletes nor relabels them. A subsequent import can add correctly keyed observations while historical wrong keys remain. #854 must reconcile that historical source/summary/app scope before claiming recovery. Its WAL ENOMEM cause, original feed completeness and unfinished jobs remain open. Do not reset or replay historical RUNNING jobs based on age or counters. Closed #318 fixed presentation of correctly labelled mixed currencies and is a distinct issue.

No production rollout, historical repair, independent acceptance or merge approval is established. Official format reference: [MTGJSON Price List](https://mtgjson.com/data-models/price/price-list/).
