# Pricing history tiers and retention gate

The default long-range card view uses observed daily closes for 90 days, weekly closes through two years, monthly closes through ten years, and yearly closes after that. Every weekly, monthly, and yearly row keeps its open, close, low, high, and the dates of those observations. A missing day remains missing. The view labels each point's resolution and plots it at its actual close date. `PRICING_DAILY_HISTORY_DAYS`, `PRICING_WEEKLY_HISTORY_YEARS`, and `PRICING_MONTHLY_HISTORY_YEARS` can change the cutoffs within validated bounds; invalid or overlapping settings fall back to 90/2/10. The short 7/30/90-day drilldown continues to use daily detail.

`price_weekly_summary` and `price_yearly_summary` are rebuildable projections from `price_daily_summary`. Worker refreshes rebuild touched exact printing/provider/finish/type/currency keys, including late corrections, while all raw and daily records remain. Existing installations need a one-time tier backfill after the #328 daily backfill has completed:

```sh
npm run worker:prices:tiers:backfill
```

Run this inside the pricing-worker container (or with the intended `PRICING_DATABASE_URL` and `psql`) after confirming the target. It refuses a stale daily summary, updates both tiers in one transaction, and sets `price_summary_state.tiers_ready` only when complete. Retry is safe. Until then, long-range card history falls back to monthly points. A full `worker:prices:summaries:rebuild` also fills the tiers and marks them ready.

## Local evidence, 2026-09-23

The local pricing database had 1,971,376 raw rows across 41 observed dates from June 30 to September 23 (about 85 calendar days). Raw snapshots occupied 931 MB, daily summaries 747 MB including indexes, and monthly summaries 63 MB. A full custom-format `pg_dump` archive was copied to `.local-data/backups/pricing/mtg-pricing-retention-audit-2026-09-23.dump` (60,724,806 bytes). `pg_restore --exit-on-error --jobs=2` loaded that copied archive into a disposable database. Live and restored databases matched on raw count, date range and price sum; daily count, range and price sum; and 153,875 monthly rows, range and close-price sum. The disposable database was dropped after comparison. The existing primary-app backup does **not** include this separate pricing database; pricing archival needs its own operating path.

The weekly/yearly backfill completed in 177,842 ms on the local snapshot: 650,052 weekly rows (269 MB) and 52,326 yearly rows (21 MB). An isolated corrected-price/repeated-refresh fixture passed. A deterministic sample of 100 weekly and 100 yearly keys compared all open/close/low/high dates and prices plus observation counts to daily source, with zero mismatches. `/login` completed in about 183 ms during the backfill; that is one local concurrency observation, not a production service-level guarantee.

## Deletion gate

The next preservation change adds `price_summary_state.daily_compacted_through` as a recorded boundary for a future daily compaction operation. A touched-key refresh still reconstructs its full daily projection from retained raw snapshots, refreshes scope and weekly/monthly/yearly tiers from that complete projection, and only then removes daily points through the recorded boundary. A local old-date fixture verifies that a later raw correction rebuilds the historical rollups without restoring the compacted daily row. The standalone tier backfill refuses to run after a boundary is recorded; a full raw-backed summary rebuild remains the recovery path. This is a refresh contract, not a compaction job: no cutoff is set and no rows are deleted by this change alone.

This batch **does not prune raw or daily rows**. The current raw span is younger than the proposed 90-day daily window, so pruning now would save nothing. More importantly, the current touched-key refresh reconstructs daily and long-range summaries from live raw rows. Deleting older raw rows before changing that refresh contract could silently erase older rollups on a later import. The archive drill proves a full copied database can be restored locally; it does not yet prove incremental archival, per-key correction after compaction, or a safe production rollback.

Before enabling retention, a separate reviewed change must: archive all rows eligible for deletion with a durable manifest/checksum; restore that archive into an isolated database and compare counts and sampled price extrema; make refresh preserve archived periods and explicitly handle late corrections; compact period boundaries without double-counting; support a dry run and rollback; and measure storage and ordinary-site latency on the intended host. No automatic pruning or production scheduling is configured here. Keep issue #330 open until those gates and the reviewed deletion behavior are complete.
