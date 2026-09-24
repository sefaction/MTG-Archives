import { queryPricingJson } from "./pricing-db-query";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export type PricingWorkerStatus = {
  available: boolean;
  error?: string;
  stats: {
    activeJobCount: number;
    failedJobCount: number;
  };
  heartbeats: Array<{
    worker_id: string;
    status: string;
    last_seen_at: string;
    message: string | null;
  }>;
  runs: Array<{
    id: string;
    worker_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    message: string | null;
    error: string | null;
  }>;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    requested_by: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    processed_count: number;
    inserted_count: number;
    skipped_count: number;
  }>;
  logs: Array<{
    id: string;
    run_id: string | null;
    worker_id: string;
    level: string;
    message: string;
    created_at: string;
  }>;
};

export type PriceHistoryRange = "7" | "30" | "90" | "all";

export type CardPriceHistoryPoint = {
  observedDate: string;
  price: number;
  lowDate?: string;
  lowPrice?: number;
  highDate?: string;
  highPrice?: number;
};

export type CardPriceHistoryChange = {
  start: number | null;
  current: number | null;
  absolute: number | null;
  percent: number | null;
};

export type CardPriceHistoryOptions = {
  mtgjsonUuid: string;
  provider?: string;
  finish?: string;
  priceType?: string;
  currency?: string;
  range?: PriceHistoryRange;
};

export type PricingDashboardOptions = {
  view?: "collection" | "market" | "data";
  provider?: string;
  finish?: string;
  priceType?: string;
  currency?: string;
  range?: PriceHistoryRange;
  ownedCards?: Array<{
    mtgjsonUuid: string;
    quantity: number;
    setCode?: string | null;
    finish?: string;
  }>;
  setCode?: string;
  minPercentChange?: number | null;
  minAbsoluteChange?: number | null;
  minPriorPrice?: number | null;
  thresholdMode?: "absolute" | "percent" | "either";
  changeDirection?: "all" | "gainers" | "losers";
};

export type PricingDashboardMover = {
  mtgjsonUuid: string;
  cardName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  startPrice: number;
  currentPrice: number;
  absoluteChange: number;
  percentChange: number | null;
  startObservedDate: string;
  currentObservedDate: string;
  ownedQuantity?: number;
  collectionImpact?: number;
  isStale?: boolean;
  cardId?: string;
};

export type PricingDashboardTrendPoint = {
  observedDate: string;
  value: number;
};

export type PricingDashboard = {
  available: boolean;
  error?: string;
  trendResolution: "daily" | "monthly";
  summaryRefreshedAt: string | null;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  range: PriceHistoryRange;
  stats: {
    snapshotCount: number;
    pricedCardCount: number;
    latestObservedDate: string | null;
    latestIngestedAt: string | null;
    providerCount: number;
    currencyCount: number;
  };
  providerCoverage: Array<{
    provider: string;
    currency: string;
    snapshotCount: number;
    pricedCardCount: number;
    latestObservedDate: string | null;
  }>;
  movementCoverage: {
    ownedPrintings: number;
    pricedPrintings: number;
    withoutPrior: number;
    stalePrintings: number;
    latestObservedDate: string | null;
  };
  topGainers: PricingDashboardMover[];
  topLosers: PricingDashboardMover[];
  topPercentMoves: PricingDashboardMover[];
  valueTrend: PricingDashboardTrendPoint[];
};

function pricingDatabaseUrl() {
  return process.env.PRICING_DATABASE_URL || "";
}

function psqlDatabaseUrl(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

function sqlString(value: string | null | undefined) {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

function cleanToken(value: string | null | undefined, fallback: string) {
  const clean = value?.trim();
  return clean && /^[a-zA-Z0-9_-]+$/.test(clean) ? clean : fallback;
}

function cleanCurrency(value: string | null | undefined) {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{3}$/.test(clean) ? clean : "USD";
}

function cleanSetCode(value: string | null | undefined) {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z0-9_]{2,8}$/.test(clean) ? clean : "";
}

function cleanPercentThreshold(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1000, value));
}

function cleanDollarThreshold(
  value: number | null | undefined,
  fallback: number,
) {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1_000_000, value));
}

function cleanDirection(value: string | null | undefined) {
  return value === "gainers" || value === "losers" ? value : "all";
}

function holdingsCte(ownedCards: PricingDashboardOptions["ownedCards"]) {
  const cards = (ownedCards ?? [])
    .filter((card) => card.mtgjsonUuid && card.quantity > 0)
    .map((card) => ({
      mtgjsonUuid: card.mtgjsonUuid,
      quantity: Math.max(1, Math.trunc(card.quantity)),
    }));
  if (!cards.length) {
    return "holdings(mtgjson_uuid, owned_quantity) AS (SELECT NULL::text, 0::int WHERE FALSE)";
  }
  const values = cards
    .map(
      (card) =>
        `(${sqlString(card.mtgjsonUuid)}::text, ${sqlNumber(card.quantity)}::int)`,
    )
    .join(", ");
  return `holdings(mtgjson_uuid, owned_quantity) AS (VALUES ${values})`;
}

export function normalizePriceHistoryRange(
  value: string | null | undefined,
): PriceHistoryRange {
  return value === "7" || value === "30" || value === "90" || value === "all"
    ? value
    : "90";
}

function runPsql(sql: string) {
  const url = pricingDatabaseUrl();
  if (!url) {
    throw new Error("PRICING_DATABASE_URL is not configured.");
  }

  const result = spawnSync(
    "psql",
    [
      psqlDatabaseUrl(url),
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
      "-f",
      "-",
    ],
    { encoding: "utf8", input: sql, maxBuffer: 1024 * 1024 * 8 },
  );

  if (result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr?.trim() ||
        result.stdout?.trim() ||
        `psql command failed with status ${result.status}`,
    );
  }

  return result.stdout.trim();
}

type PricingReadQuery = <T>(sql: string) => Promise<T[]>;

function jsonQuery<T>(sql: string): Promise<T[]> {
  return queryPricingJson<T>(sql, { timeoutMs: 10_000 });
}

export function calculatePriceHistoryChange(
  points: CardPriceHistoryPoint[],
): CardPriceHistoryChange {
  const start = points[0]?.price ?? null;
  const current = points[points.length - 1]?.price ?? null;
  const absolute =
    start === null || current === null
      ? null
      : Number((current - start).toFixed(4));
  const percent =
    start === null || current === null || start === 0
      ? null
      : Number((((current - start) / start) * 100).toFixed(2));
  return { start, current, absolute, percent };
}

export async function getCardPriceHistory(options: CardPriceHistoryOptions) {
  const provider = cleanToken(options.provider, "tcgplayer");
  const finish = cleanToken(options.finish, "normal");
  const priceType = cleanToken(options.priceType, "retail");
  const currency = cleanCurrency(options.currency);
  const range = normalizePriceHistoryRange(options.range);
  const points = await jsonQuery<CardPriceHistoryPoint>(
    range === "all"
      ? `SELECT
       close_date::text AS "observedDate",
       close_price::float8 AS price,
       low_date::text AS "lowDate", low_price::float8 AS "lowPrice",
       high_date::text AS "highDate", high_price::float8 AS "highPrice"
     FROM price_monthly_summary
     WHERE mtgjson_uuid = ${sqlString(options.mtgjsonUuid)}
       AND provider = ${sqlString(provider)}
       AND finish = ${sqlString(finish)}
       AND price_type = ${sqlString(priceType)}
       AND currency = ${sqlString(currency)}
     ORDER BY month_start ASC
     LIMIT 400`
      : `SELECT
       observed_date::text AS "observedDate",
       price::float8 AS price
     FROM price_daily_summary
     WHERE mtgjson_uuid = ${sqlString(options.mtgjsonUuid)}
       AND provider = ${sqlString(provider)}
       AND finish = ${sqlString(finish)}
       AND price_type = ${sqlString(priceType)}
       AND currency = ${sqlString(currency)}
       AND observed_date >= (
         SELECT MAX(latest_observed_date) - INTERVAL '${Number(range)} days'
         FROM price_scope_summary
         WHERE mtgjson_uuid = ${sqlString(options.mtgjsonUuid)}
           AND provider = ${sqlString(provider)}
           AND finish = ${sqlString(finish)}
           AND price_type = ${sqlString(priceType)}
           AND currency = ${sqlString(currency)}
       )
     ORDER BY observed_date ASC
     LIMIT 400`,
  );

  return {
    provider,
    finish,
    priceType,
    currency,
    range,
    resolution: range === "all" ? "monthly" : "daily",
    points,
    change: calculatePriceHistoryChange(points),
  };
}

function emptyPricingDashboard(
  options: Required<
    Pick<
      PricingDashboard,
      "provider" | "finish" | "priceType" | "currency" | "range"
    >
  >,
  error?: string,
): PricingDashboard {
  return {
    available: !error,
    error,
    ...options,
    trendResolution: options.range === "all" ? "monthly" : "daily",
    summaryRefreshedAt: null,
    stats: {
      snapshotCount: 0,
      pricedCardCount: 0,
      latestObservedDate: null,
      latestIngestedAt: null,
      providerCount: 0,
      currencyCount: 0,
    },
    providerCoverage: [],
    movementCoverage: {
      ownedPrintings: 0,
      pricedPrintings: 0,
      withoutPrior: 0,
      stalePrintings: 0,
      latestObservedDate: null,
    },
    topGainers: [],
    topLosers: [],
    topPercentMoves: [],
    valueTrend: [],
  };
}

export async function getPricingDashboard(
  options: PricingDashboardOptions = {},
  query: PricingReadQuery = jsonQuery,
): Promise<PricingDashboard> {
  const view = options.view ?? "collection";
  const provider = cleanToken(options.provider, "tcgplayer");
  const finish = cleanToken(options.finish, "normal");
  const priceType = cleanToken(options.priceType, "retail");
  const currency = cleanCurrency(options.currency);
  const range = normalizePriceHistoryRange(options.range);
  const setCode = cleanSetCode(options.setCode);
  const minPercentChange = cleanPercentThreshold(options.minPercentChange);
  const minAbsoluteChange = cleanDollarThreshold(options.minAbsoluteChange, 2);
  const minPriorPrice = cleanDollarThreshold(options.minPriorPrice, 1);
  const thresholdMode =
    options.thresholdMode === "percent" || options.thresholdMode === "either"
      ? options.thresholdMode
      : "absolute";
  const changeDirection = cleanDirection(options.changeDirection);
  const dashboardOptions = { provider, finish, priceType, currency, range };
  const scopedOwnedCards = options.ownedCards?.filter(
    (card) =>
      (!setCode || card.setCode?.toUpperCase() === setCode) &&
      (!card.finish || card.finish === finish),
  );
  if (!scopedOwnedCards?.some((card) => card.mtgjsonUuid && card.quantity > 0))
    return emptyPricingDashboard(dashboardOptions);
  const holdingsSql = holdingsCte(scopedOwnedCards);
  const currentWindowSql =
    range === "all"
      ? "TRUE"
      : `c.latest_observed_date >= b.latest_observed_date - INTERVAL '${Number(range)} days'`;
  const absoluteCriterion = `ABS("absoluteChange") >= ${sqlNumber(minAbsoluteChange)}`;
  const percentCriterion =
    `("startPrice" >= ${sqlNumber(minPriorPrice)}` +
    ` AND ABS("percentChange") >= ${sqlNumber(minPercentChange ?? 25)})`;
  const materialMovementSql =
    thresholdMode === "percent"
      ? `AND ${percentCriterion}`
      : thresholdMode === "either"
        ? `AND (${absoluteCriterion} OR ${percentCriterion})`
        : `AND ${absoluteCriterion}`;
  const directionSql =
    changeDirection === "gainers"
      ? `AND "absoluteChange" > 0`
      : changeDirection === "losers"
        ? `AND "absoluteChange" < 0`
        : "";

  try {
    const [summaryState] = await query<{
      ready: boolean;
      sourceMaxId: number | null;
      rawMaxId: number | null;
      refreshedAt: string | null;
    }>(`SELECT ready, source_max_id AS "sourceMaxId",
         (SELECT MAX(id) FROM price_snapshots) AS "rawMaxId",
         refreshed_at::text AS "refreshedAt"
       FROM price_summary_state WHERE singleton = TRUE`);
    if (
      !summaryState?.ready ||
      summaryState.sourceMaxId !== summaryState.rawMaxId
    ) {
      return emptyPricingDashboard(
        dashboardOptions,
        "Pricing summaries are rebuilding or behind new observations. Try again shortly.",
      );
    }
    const [stats] =
      view !== "market"
        ? await query<PricingDashboard["stats"]>(
            `WITH ${holdingsSql},
       scoped AS (
         SELECT ps.*
         FROM price_scope_summary ps
         JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
         WHERE ps.mtgjson_uuid IS NOT NULL
       )
       SELECT
         COALESCE(SUM(snapshot_count), 0)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(latest_observed_date)::text AS "latestObservedDate",
         MAX(latest_ingested_at)::text AS "latestIngestedAt",
         COUNT(DISTINCT provider)::int AS "providerCount",
         COUNT(DISTINCT currency)::int AS "currencyCount"
       FROM scoped`,
          )
        : [];

    const providerCoverage =
      view === "data"
        ? await query<PricingDashboard["providerCoverage"][0]>(
            `WITH ${holdingsSql},
       scoped AS (
         SELECT ps.*
         FROM price_scope_summary ps
         JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
         WHERE ps.mtgjson_uuid IS NOT NULL
       )
       SELECT
         provider,
         currency,
         SUM(snapshot_count)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(latest_observed_date)::text AS "latestObservedDate"
       FROM scoped
       GROUP BY provider, currency
       ORDER BY "snapshotCount" DESC, provider ASC, currency ASC
       LIMIT 12`,
          )
        : [];

    const [movementCoverage] =
      view === "market"
        ? await query<PricingDashboard["movementCoverage"]>(`WITH ${holdingsSql}
       SELECT COUNT(*)::int AS "ownedPrintings",
         COUNT(c.mtgjson_uuid)::int AS "pricedPrintings",
         COUNT(*) FILTER (WHERE c.mtgjson_uuid IS NOT NULL AND c.prior_observed_date IS NULL)::int AS "withoutPrior",
         COUNT(*) FILTER (WHERE c.latest_observed_date < CURRENT_DATE - INTERVAL '2 days')::int AS "stalePrintings",
         MAX(c.latest_observed_date)::text AS "latestObservedDate"
       FROM holdings h LEFT JOIN price_scope_summary c
         ON c.mtgjson_uuid = h.mtgjson_uuid
         AND c.provider = ${sqlString(provider)}
         AND c.finish = ${sqlString(finish)}
         AND c.price_type = ${sqlString(priceType)}
         AND c.currency = ${sqlString(currency)}`)
        : [];

    const movementRows =
      view === "market"
        ? await query<
            PricingDashboardMover & { category: string }
          >(`WITH ${holdingsSql},
       filtered AS (
         SELECT c.*, h.owned_quantity FROM price_scope_summary c
         JOIN holdings h ON h.mtgjson_uuid = c.mtgjson_uuid
         WHERE c.provider = ${sqlString(provider)}
           AND c.finish = ${sqlString(finish)}
           AND c.price_type = ${sqlString(priceType)}
           AND c.currency = ${sqlString(currency)}
       ),
       bounds AS (SELECT MAX(latest_observed_date) AS latest_observed_date FROM filtered),
       movement_rows AS (
         SELECT c.mtgjson_uuid AS "mtgjsonUuid",
           NULL::text AS "cardName", NULL::text AS "setCode",
           NULL::text AS "collectorNumber",
           c.prior_price::float8 AS "startPrice",
           c.current_price::float8 AS "currentPrice",
           ROUND((c.current_price - c.prior_price)::numeric, 4)::float8 AS "absoluteChange",
           CASE WHEN c.prior_price = 0 THEN NULL
             ELSE ROUND((((c.current_price - c.prior_price) / c.prior_price) * 100)::numeric, 2)::float8
           END AS "percentChange",
           c.prior_observed_date::text AS "startObservedDate",
           c.latest_observed_date::text AS "currentObservedDate",
           c.owned_quantity AS "ownedQuantity",
           ROUND(((c.current_price - c.prior_price) * c.owned_quantity)::numeric, 2)::float8 AS "collectionImpact",
           (c.latest_observed_date < CURRENT_DATE - INTERVAL '2 days') AS "isStale"
         FROM filtered c CROSS JOIN bounds b
         WHERE ${currentWindowSql}
           AND c.prior_observed_date IS NOT NULL
           AND c.prior_price <> c.current_price
       )
       SELECT * FROM (
         (SELECT 'gainer'::text AS category, m.* FROM movement_rows m
          WHERE "absoluteChange" > 0 ${materialMovementSql} ${directionSql}
          ORDER BY "collectionImpact" DESC, "absoluteChange" DESC LIMIT 20)
         UNION ALL
         (SELECT 'loser'::text AS category, m.* FROM movement_rows m
          WHERE "absoluteChange" < 0 ${materialMovementSql} ${directionSql}
          ORDER BY "collectionImpact" ASC, "absoluteChange" ASC LIMIT 20)
         UNION ALL
         (SELECT 'percent'::text AS category, m.* FROM movement_rows m
          WHERE "percentChange" IS NOT NULL ${materialMovementSql} ${directionSql}
          ORDER BY ABS("percentChange") DESC, ABS("absoluteChange") DESC LIMIT 20)
       ) ranked`)
        : [];
    const topGainers = movementRows.filter((row) => row.category === "gainer");
    const topLosers = movementRows.filter((row) => row.category === "loser");
    const topPercentMoves = movementRows.filter(
      (row) => row.category === "percent",
    );

    const valueTrend =
      view === "collection"
        ? await query<PricingDashboardTrendPoint>(
            range === "all"
              ? `WITH ${holdingsSql}
       SELECT m.month_start::text AS "observedDate",
         ROUND(SUM(m.close_price * h.owned_quantity)::numeric, 2)::float8 AS value
       FROM price_monthly_summary m
       JOIN holdings h ON h.mtgjson_uuid = m.mtgjson_uuid
       WHERE m.provider = ${sqlString(provider)}
         AND m.finish = ${sqlString(finish)}
         AND m.price_type = ${sqlString(priceType)}
         AND m.currency = ${sqlString(currency)}
       GROUP BY m.month_start
       ORDER BY m.month_start ASC
       LIMIT 400`
              : `WITH ${holdingsSql},
       bounds AS (
         SELECT MAX(c.latest_observed_date) AS latest_observed_date
         FROM price_scope_summary c
         JOIN holdings h ON h.mtgjson_uuid = c.mtgjson_uuid
         WHERE c.provider = ${sqlString(provider)}
           AND c.finish = ${sqlString(finish)}
           AND c.price_type = ${sqlString(priceType)}
           AND c.currency = ${sqlString(currency)}
       )
       SELECT
         d.observed_date::text AS "observedDate",
         ROUND(SUM(d.price * h.owned_quantity)::numeric, 2)::float8 AS value
       FROM price_daily_summary d
       JOIN holdings h ON h.mtgjson_uuid = d.mtgjson_uuid
       CROSS JOIN bounds b
       WHERE d.provider = ${sqlString(provider)}
         AND d.finish = ${sqlString(finish)}
         AND d.price_type = ${sqlString(priceType)}
         AND d.currency = ${sqlString(currency)}
         AND d.observed_date >= b.latest_observed_date - INTERVAL '${Number(range)} days'
       GROUP BY d.observed_date
       ORDER BY d.observed_date ASC
       LIMIT 400`,
          )
        : [];

    return {
      available: true,
      ...dashboardOptions,
      trendResolution: range === "all" ? "monthly" : "daily",
      summaryRefreshedAt: summaryState.refreshedAt,
      stats: stats ?? emptyPricingDashboard(dashboardOptions).stats,
      providerCoverage,
      movementCoverage:
        movementCoverage ??
        emptyPricingDashboard(dashboardOptions).movementCoverage,
      topGainers,
      topLosers,
      topPercentMoves,
      valueTrend,
    };
  } catch (error) {
    return emptyPricingDashboard(
      dashboardOptions,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function listPricingWorkerStatus(): Promise<PricingWorkerStatus> {
  try {
    const [stats] = await queryPricingJson<PricingWorkerStatus["stats"]>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('QUEUED','RUNNING'))::int AS "activeJobCount",
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS "failedJobCount"
       FROM price_import_jobs`,
      { timeoutMs: 10_000 },
    );

    return {
      available: true,
      stats: stats ?? {
        activeJobCount: 0,
        failedJobCount: 0,
      },
      heartbeats: await queryPricingJson(
        `SELECT worker_id, status, last_seen_at, message
         FROM price_worker_heartbeats
         ORDER BY last_seen_at DESC
         LIMIT 5`,
      ),
      runs: await queryPricingJson(
        `SELECT id, worker_id, status, started_at, finished_at, message, error
         FROM price_worker_runs
         ORDER BY started_at DESC
         LIMIT 10`,
      ),
      jobs: await queryPricingJson(
        `SELECT id, type, status, requested_by, created_at, started_at, finished_at, error,
                processed_count, inserted_count, skipped_count
         FROM price_import_jobs
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
      logs: await queryPricingJson(
        `SELECT id::text, run_id, worker_id, level, message, created_at
         FROM price_worker_logs
         ORDER BY created_at DESC
         LIMIT 20`,
      ),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      stats: {
        activeJobCount: 0,
        failedJobCount: 0,
      },
      heartbeats: [],
      runs: [],
      jobs: [],
      logs: [],
    };
  }
}

export async function enqueuePricingRefreshJob(requestedBy: string | null) {
  return enqueuePricingJob("MTGJSON_REFRESH_ALL", requestedBy);
}

export async function enqueueMtgjsonMappingJob(requestedBy: string | null) {
  return enqueuePricingJob("MTGJSON_MAP_IDENTIFIERS", requestedBy);
}

async function enqueuePricingJob(type: string, requestedBy: string | null) {
  const id = randomUUID();
  runPsql(
    `INSERT INTO price_import_jobs (id, type, status, requested_by, payload_json)
     VALUES (
       ${sqlString(id)},
       ${sqlString(type)},
       'QUEUED',
       ${sqlString(requestedBy)},
       '{"source":"admin"}'::jsonb
     );`,
  );
  return id;
}
