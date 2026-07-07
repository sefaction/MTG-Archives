import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export type PricingWorkerStatus = {
  available: boolean;
  error?: string;
  stats: {
    snapshotCount: number;
    pricedCardCount: number;
    latestObservedDate: string | null;
    latestIngestedAt: string | null;
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
  provider?: string;
  finish?: string;
  priceType?: string;
  currency?: string;
  range?: PriceHistoryRange;
  ownedCards?: Array<{ mtgjsonUuid: string; quantity: number }>;
  setCode?: string;
  minPercentChange?: number | null;
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
};

export type PricingDashboardTrendPoint = {
  observedDate: string;
  value: number;
};

export type PricingDashboard = {
  available: boolean;
  error?: string;
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

function rangePredicate(range: PriceHistoryRange) {
  if (range === "all") return "TRUE";
  return `observed_date >= (CURRENT_DATE - INTERVAL '${Number(range)} days')`;
}

function anchoredRangePredicate(range: PriceHistoryRange) {
  if (range === "all") return "TRUE";
  return `f.observed_date >= b.latest_observed_date - INTERVAL '${Number(
    range,
  )} days'`;
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

function jsonQuery<T>(sql: string): T[] {
  const output = runPsql(
    `SELECT COALESCE(json_agg(row_to_json(rows)), '[]'::json) FROM (${sql}) rows;`,
  );
  return JSON.parse(output || "[]") as T[];
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
  const points = jsonQuery<CardPriceHistoryPoint>(
    `SELECT
       observed_date::text AS "observedDate",
       price::float8 AS price
     FROM price_snapshots
     WHERE mtgjson_uuid = ${sqlString(options.mtgjsonUuid)}
       AND provider = ${sqlString(provider)}
       AND finish = ${sqlString(finish)}
       AND price_type = ${sqlString(priceType)}
       AND currency = ${sqlString(currency)}
       AND ${rangePredicate(range)}
     ORDER BY observed_date ASC
     LIMIT 400`,
  );

  return {
    provider,
    finish,
    priceType,
    currency,
    range,
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
    stats: {
      snapshotCount: 0,
      pricedCardCount: 0,
      latestObservedDate: null,
      latestIngestedAt: null,
      providerCount: 0,
      currencyCount: 0,
    },
    providerCoverage: [],
    topGainers: [],
    topLosers: [],
    topPercentMoves: [],
    valueTrend: [],
  };
}

export async function getPricingDashboard(
  options: PricingDashboardOptions = {},
): Promise<PricingDashboard> {
  const provider = cleanToken(options.provider, "tcgplayer");
  const finish = cleanToken(options.finish, "normal");
  const priceType = cleanToken(options.priceType, "retail");
  const currency = cleanCurrency(options.currency);
  const range = normalizePriceHistoryRange(options.range);
  const setCode = cleanSetCode(options.setCode);
  const minPercentChange = cleanPercentThreshold(options.minPercentChange);
  const changeDirection = cleanDirection(options.changeDirection);
  const dashboardOptions = { provider, finish, priceType, currency, range };
  const holdingsSql = holdingsCte(options.ownedCards);
  const scopedSetSql = setCode
    ? `AND upper(set_code) = ${sqlString(setCode)}`
    : "";
  const percentThresholdSql =
    minPercentChange == null
      ? ""
      : `AND ABS("percentChange") >= ${sqlNumber(minPercentChange)}`;
  const directionSql =
    changeDirection === "gainers"
      ? `AND "absoluteChange" > 0`
      : changeDirection === "losers"
        ? `AND "absoluteChange" < 0`
        : "";

  try {
    const [stats] = jsonQuery<PricingDashboard["stats"]>(
      `WITH ${holdingsSql},
       scoped AS (
         SELECT ps.*
         FROM price_snapshots ps
         JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
         WHERE ps.mtgjson_uuid IS NOT NULL
           ${scopedSetSql}
       )
       SELECT
         COUNT(*)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(observed_date)::text AS "latestObservedDate",
         MAX(created_at)::text AS "latestIngestedAt",
         COUNT(DISTINCT provider)::int AS "providerCount",
         COUNT(DISTINCT currency)::int AS "currencyCount"
       FROM scoped`,
    );

    const providerCoverage = jsonQuery<PricingDashboard["providerCoverage"][0]>(
      `WITH ${holdingsSql},
       scoped AS (
         SELECT ps.*
         FROM price_snapshots ps
         JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
         WHERE ps.mtgjson_uuid IS NOT NULL
           ${scopedSetSql}
       )
       SELECT
         provider,
         currency,
         COUNT(*)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(observed_date)::text AS "latestObservedDate"
       FROM scoped
       GROUP BY provider, currency
       ORDER BY "snapshotCount" DESC, provider ASC, currency ASC
       LIMIT 12`,
    );

    const movementBaseSql = `
      WITH ${holdingsSql},
      filtered AS (
        SELECT ps.*
        FROM price_snapshots ps
        JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
        WHERE ps.mtgjson_uuid IS NOT NULL
          AND provider = ${sqlString(provider)}
          AND finish = ${sqlString(finish)}
          AND price_type = ${sqlString(priceType)}
          AND currency = ${sqlString(currency)}
          ${scopedSetSql}
      ),
      bounds AS (
        SELECT MAX(observed_date) AS latest_observed_date
        FROM filtered
      ),
      range_points AS (
        SELECT f.*
        FROM filtered f
        CROSS JOIN bounds b
        WHERE b.latest_observed_date IS NOT NULL
          AND ${anchoredRangePredicate(range)}
      ),
      start_rows AS (
        SELECT DISTINCT ON (mtgjson_uuid)
          mtgjson_uuid,
          card_name,
          set_code,
          collector_number,
          observed_date,
          price
        FROM range_points
        ORDER BY mtgjson_uuid, observed_date ASC, created_at ASC
      ),
      current_rows AS (
        SELECT DISTINCT ON (mtgjson_uuid)
          mtgjson_uuid,
          card_name,
          set_code,
          collector_number,
          observed_date,
          price
        FROM range_points
        ORDER BY mtgjson_uuid, observed_date DESC, created_at DESC
      ),
      movement_rows AS (
        SELECT
          c.mtgjson_uuid AS "mtgjsonUuid",
          COALESCE(c.card_name, s.card_name) AS "cardName",
          COALESCE(c.set_code, s.set_code) AS "setCode",
          COALESCE(c.collector_number, s.collector_number) AS "collectorNumber",
          s.price::float8 AS "startPrice",
          c.price::float8 AS "currentPrice",
          ROUND((c.price - s.price)::numeric, 4)::float8 AS "absoluteChange",
          CASE
            WHEN s.price = 0 THEN NULL
            ELSE ROUND((((c.price - s.price) / s.price) * 100)::numeric, 2)::float8
          END AS "percentChange",
          s.observed_date::text AS "startObservedDate",
          c.observed_date::text AS "currentObservedDate"
        FROM current_rows c
        JOIN start_rows s ON s.mtgjson_uuid = c.mtgjson_uuid
        WHERE c.observed_date <> s.observed_date
          AND c.price <> s.price
      )`;

    const topGainers = jsonQuery<PricingDashboardMover>(
      `${movementBaseSql}
       SELECT *
       FROM movement_rows
       WHERE "absoluteChange" > 0
         ${percentThresholdSql}
         ${directionSql}
       ORDER BY "absoluteChange" DESC, "currentPrice" DESC
       LIMIT 20`,
    );
    const topLosers = jsonQuery<PricingDashboardMover>(
      `${movementBaseSql}
       SELECT *
       FROM movement_rows
       WHERE "absoluteChange" < 0
         ${percentThresholdSql}
         ${directionSql}
       ORDER BY "absoluteChange" ASC, "currentPrice" ASC
       LIMIT 20`,
    );
    const topPercentMoves = jsonQuery<PricingDashboardMover>(
      `${movementBaseSql}
       SELECT *
       FROM movement_rows
       WHERE "percentChange" IS NOT NULL
         ${percentThresholdSql}
         ${directionSql}
       ORDER BY ABS("percentChange") DESC, ABS("absoluteChange") DESC
       LIMIT 20`,
    );

    const valueTrend = jsonQuery<PricingDashboardTrendPoint>(
      `WITH ${holdingsSql},
       filtered AS (
         SELECT ps.*, h.owned_quantity
         FROM price_snapshots ps
         JOIN holdings h ON h.mtgjson_uuid = ps.mtgjson_uuid
         WHERE ps.mtgjson_uuid IS NOT NULL
           AND provider = ${sqlString(provider)}
           AND finish = ${sqlString(finish)}
           AND price_type = ${sqlString(priceType)}
           AND currency = ${sqlString(currency)}
           ${scopedSetSql}
       ),
       bounds AS (
         SELECT MAX(observed_date) AS latest_observed_date
         FROM filtered
       ),
       daily_cards AS (
         SELECT DISTINCT ON (f.observed_date, f.mtgjson_uuid)
           f.observed_date,
           f.mtgjson_uuid,
           f.price,
           f.owned_quantity
         FROM filtered f
         CROSS JOIN bounds b
         WHERE b.latest_observed_date IS NOT NULL
           AND ${anchoredRangePredicate(range)}
         ORDER BY f.observed_date, f.mtgjson_uuid, f.created_at DESC
       )
       SELECT
         observed_date::text AS "observedDate",
         ROUND(SUM(price * owned_quantity)::numeric, 2)::float8 AS value
       FROM daily_cards
       GROUP BY observed_date
       ORDER BY observed_date ASC
       LIMIT 400`,
    );

    return {
      available: true,
      ...dashboardOptions,
      stats: stats ?? emptyPricingDashboard(dashboardOptions).stats,
      providerCoverage,
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
    const [stats] = jsonQuery<PricingWorkerStatus["stats"]>(
      `SELECT
         COUNT(*)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(observed_date)::text AS "latestObservedDate",
         MAX(created_at)::text AS "latestIngestedAt",
         (
           SELECT COUNT(*)::int
           FROM price_import_jobs
           WHERE status IN ('QUEUED', 'RUNNING')
         ) AS "activeJobCount",
         (
           SELECT COUNT(*)::int
           FROM price_import_jobs
           WHERE status = 'FAILED'
         ) AS "failedJobCount"
       FROM price_snapshots`,
    );

    return {
      available: true,
      stats: stats ?? {
        snapshotCount: 0,
        pricedCardCount: 0,
        latestObservedDate: null,
        latestIngestedAt: null,
        activeJobCount: 0,
        failedJobCount: 0,
      },
      heartbeats: jsonQuery(
        `SELECT worker_id, status, last_seen_at, message
         FROM price_worker_heartbeats
         ORDER BY last_seen_at DESC
         LIMIT 5`,
      ),
      runs: jsonQuery(
        `SELECT id, worker_id, status, started_at, finished_at, message, error
         FROM price_worker_runs
         ORDER BY started_at DESC
         LIMIT 10`,
      ),
      jobs: jsonQuery(
        `SELECT id, type, status, requested_by, created_at, started_at, finished_at, error,
                processed_count, inserted_count, skipped_count
         FROM price_import_jobs
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
      logs: jsonQuery(
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
        snapshotCount: 0,
        pricedCardCount: 0,
        latestObservedDate: null,
        latestIngestedAt: null,
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
