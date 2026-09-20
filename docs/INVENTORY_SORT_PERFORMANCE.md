# Inventory render sorting follow-up (#220 / #224)

The preceding release narrowed query metadata, but page preparation still took multiple seconds for 9,554 exact groups. The page diagnostics start after expression evaluation, so that time could not be attributed solely to the expression metadata query. The shared sort comparator called localeCompare with options on every comparison, including primary strings, numeric fallbacks, collector suffixes and ID tie-breaks.

This batch reuses two Intl.Collator instances with the exact original default locale/options. It changes neither filtering nor ownership scope, SQL, grouping, null placement, tie-break direction, page sizes, or stored data. There is no user-data/result cache. Private pages, list APIs and public inventory already share this comparator. Collector suffixes retain their separate original numeric-only collation configuration.

Synthetic read-only CPU benchmark: `npx.cmd tsx scripts/benchmark-inventory-sort.ts`. Two sorts of 10,000 deterministic synthetic groups measured 2,214 / 1,790 / 2,092 ms before and 140 / 117 / 131 ms after on the laptop. These are individual measurements, not service-level guarantees. Unit parity covers Unicode/accent/case/natural numeric strings, collector suffixes, numeric fallbacks, ID ties and missing values against the prior localeCompare behavior.

Pre-change browser apply-to-visible baseline: 4,644 / 3,379 / 3,782 / 3,783 ms in four fresh authenticated admin sessions on main e98266f. About 248 KB transferred / 722 KB decoded per result. Full local Docker/browser comparison and unchanged regression assertions are required before claiming end-to-end improvement. A CPU improvement does not by itself prove every historical intermittent navigation/streaming failure fixed.

## Local Docker results (2026-09-20)

Application `59f7a23`, healthy Docker image `sha256:71d953cac99879eceef13fbdb88d28a875ab1adefb3ae346feaffd9248cc140f`, host HTTP 200. Four fresh authenticated sessions with the same `t:creature` query rendered in 2,790 / 3,205 / 2,254 / 2,244 ms (median 2,522 ms versus 3,783 ms before, about 33% lower). Response completion was 1,918–2,569 ms with unchanged decoded response size of 722,154 bytes. These sequential laptop samples are not controlled load-test guarantees; other projects share this machine.

Eight repeated private/public expression and color-filter browser cases passed with unchanged assertions/timeouts. The first diagnostic attempt stopped at the bootstrap password-change screen before measuring inventory; existing login helpers completed that expected step, and the four comparable samples above then completed. The underlying startup credential-reset behavior is separately tracked as #242, not hidden as an inventory timing failure.

Keep #220 open for observation of intermittent navigation failures. This change reduces a demonstrated CPU bottleneck and addresses #224, but does not establish the cause of every historical timeout. Full verification results will be recorded in the batch PR and checkpoint.
