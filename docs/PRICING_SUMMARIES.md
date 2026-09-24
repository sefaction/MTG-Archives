# Pricing history summaries

The separate Pricing PostgreSQL database keeps `price_snapshots` as the raw, authoritative observation ledger. `price_daily_summary` retains the latest ingested observation for each exact MTGJSON printing, provider, finish, price type, currency and day, with its raw snapshot ID. `price_scope_summary` records the current and preceding valid daily observation plus raw count and freshness per scope. `price_monthly_summary` stores each month's open, close, minimum and maximum prices, dates and observation count; this preserves visible spikes when the all-history collection chart uses monthly closing points. Missing observations are absent, not zero. A zero prior price yields no percentage change. The chart applies **today's quantities** to historical prices; it does not reconstruct past ownership.

The worker refreshes only scope keys touched by an MTGJSON import. It rebuilds from raw rows inside per-chunk transactions, so retrying after a partial import or correcting a historical observation is idempotent. A first-time installation or migration with existing raw history needs a full rebuild:

```sh
MTG_LOCAL_PILOT_TEST=1 npm run worker:prices:summaries:verify
npm run worker:prices:summaries:rebuild
```

The verification command is for the disposable local pricing database only. Run the rebuild command from the pricing-worker container or another environment with the intended `PRICING_DATABASE_URL` and `psql`; verify the target first. The rebuild marks `price_summary_state.ready` false until it completes and records the highest raw snapshot ID at completion. Pricing shows a recoverable unavailable state when summaries are incomplete or behind a new raw observation. An interrupted rebuild can be rerun safely. Do not prune raw or old daily rows until #330 verifies complete backfill, sampling, backup/restore and rollback.

On the 2026-09-23 local snapshot, the full rebuild processed 5,734 printings and 1.97 million raw rows in about 217 seconds. Summary storage measured about 22 MB for scopes, 747 MB for daily points including indexes, and 63 MB for monthly points. The daily table is intentionally not yet pruned; the current raw date range is within 90 days. The runtime benefit comes from querying 51,000 scope rows for coverage/current movement and bounded indexed daily/monthly points for charts, rather than repeatedly aggregating the raw ledger. #330 will establish a verified retention and compaction policy.
