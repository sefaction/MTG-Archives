import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { extractMtgjsonPriceSnapshots } from "../lib/pricing-mtgjson";

type WorkerOptions = {
  once: boolean;
  intervalMs: number;
  workerId: string;
  databaseUrl: string;
  appDatabaseUrl: string | null;
  mtgjsonAllPricesUrl: string;
  defaultCurrency: string;
  importBatchSize: number;
  maxCards: number;
};

const args = new Set(process.argv.slice(2));

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function redactDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.username = parsed.username ? "REDACTED" : "";
    parsed.password = parsed.password ? "REDACTED" : "";
    return parsed.toString();
  } catch {
    return "[invalid database url]";
  }
}

function psqlDatabaseUrl(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

function options(): WorkerOptions {
  const databaseUrl = process.env.PRICING_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("PRICING_DATABASE_URL is required for the pricing worker.");
  }

  return {
    once: args.has("--once"),
    intervalMs: envInt("PRICING_WORKER_INTERVAL_MS", 15 * 60 * 1000),
    workerId:
      process.env.PRICING_WORKER_ID ||
      `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    databaseUrl,
    appDatabaseUrl: process.env.APP_DATABASE_URL || null,
    mtgjsonAllPricesUrl:
      process.env.MTGJSON_ALL_PRICES_URL ||
      `${process.env.MTGJSON_BASE_URL || "https://mtgjson.com/api/v5"}/AllPricesToday.json`,
    defaultCurrency: process.env.MTGJSON_PRICE_CURRENCY_DEFAULT || "USD",
    importBatchSize: envInt("PRICING_IMPORT_BATCH_SIZE", 500),
    maxCards: envInt("PRICING_IMPORT_MAX_CARDS", 0),
  };
}

function psql(databaseUrl: string, sql: string) {
  const psqlUrl = psqlDatabaseUrl(databaseUrl);
  const result = spawnSync(
    "psql",
    [psqlUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "psql command failed",
    );
  }
}

function psqlOutput(databaseUrl: string, sql: string) {
  const psqlUrl = psqlDatabaseUrl(databaseUrl);
  const result = spawnSync(
    "psql",
    [psqlUrl, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "psql command failed",
    );
  }

  return result.stdout.trim();
}

function sqlString(value: string | null | undefined) {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlJson(value: unknown) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function initializeSchema(databaseUrl: string) {
  psql(
    databaseUrl,
    `
CREATE TABLE IF NOT EXISTS price_worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message TEXT
);

CREATE TABLE IF NOT EXISTS price_worker_runs (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  message TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS price_worker_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT,
  worker_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_import_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT
);

ALTER TABLE price_import_jobs
  ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inserted_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  scryfall_id TEXT,
  mtgjson_uuid TEXT,
  card_name TEXT,
  set_code TEXT,
  collector_number TEXT,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  observed_date DATE NOT NULL,
  price NUMERIC(12, 4) NOT NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS price_snapshots_identity_key
  ON price_snapshots (
    (COALESCE(mtgjson_uuid, '')),
    (COALESCE(scryfall_id, '')),
    provider,
    finish,
    price_type,
    currency,
    observed_date
  );

CREATE INDEX IF NOT EXISTS price_snapshots_card_observed_idx
  ON price_snapshots (scryfall_id, mtgjson_uuid, observed_date DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_provider_currency_observed_idx
  ON price_snapshots (provider, currency, observed_date DESC);

CREATE INDEX IF NOT EXISTS price_import_jobs_status_created_idx
  ON price_import_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS price_worker_logs_created_idx
  ON price_worker_logs (created_at DESC);
`,
  );
}

function heartbeat(
  databaseUrl: string,
  workerId: string,
  status: string,
  message: string,
) {
  psql(
    databaseUrl,
    `
INSERT INTO price_worker_heartbeats (worker_id, status, last_seen_at, message)
VALUES (${sqlString(workerId)}, ${sqlString(status)}, now(), ${sqlString(message)})
ON CONFLICT (worker_id) DO UPDATE SET
  status = EXCLUDED.status,
  last_seen_at = EXCLUDED.last_seen_at,
  message = EXCLUDED.message;
`,
  );
}

function log(
  databaseUrl: string,
  runId: string | null,
  workerId: string,
  level: "info" | "error",
  message: string,
  metadata?: unknown,
) {
  psql(
    databaseUrl,
    `
INSERT INTO price_worker_logs (run_id, worker_id, level, message, metadata_json)
VALUES (${sqlString(runId)}, ${sqlString(workerId)}, ${sqlString(level)}, ${sqlString(message)}, ${
      metadata === undefined ? "NULL" : sqlJson(metadata)
    });
`,
  );
}

function claimQueuedJobs(databaseUrl: string) {
  const output = psqlOutput(
    databaseUrl,
    `
WITH claimed AS (
  UPDATE price_import_jobs
  SET status = 'RUNNING',
      started_at = now()
  WHERE id IN (
    SELECT id
    FROM price_import_jobs
    WHERE status = 'QUEUED'
    ORDER BY created_at ASC
    LIMIT 5
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, type
)
SELECT COALESCE(json_agg(row_to_json(claimed)), '[]'::json) FROM claimed;
`,
  );
  return JSON.parse(output || "[]") as Array<{ id: string; type: string }>;
}

function completeJob(
  databaseUrl: string,
  jobId: string,
  status: string,
  counts: { processed: number; inserted: number; skipped: number },
  error?: string,
) {
  psql(
    databaseUrl,
    `
UPDATE price_import_jobs
SET status = ${sqlString(status)},
    finished_at = now(),
    processed_count = ${counts.processed},
    inserted_count = ${counts.inserted},
    skipped_count = ${counts.skipped},
    error = ${sqlString(error)}
WHERE id = ${sqlString(jobId)};
`,
  );
}

async function fetchMtgjsonAllPrices(opts: WorkerOptions) {
  const response = await fetch(opts.mtgjsonAllPricesUrl, {
    headers: { "user-agent": "MTG-Archives pricing-worker" },
  });
  if (!response.ok) {
    throw new Error(
      `MTGJSON price fetch failed with HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function insertSnapshots(
  databaseUrl: string,
  snapshots: ReturnType<typeof extractMtgjsonPriceSnapshots>,
  batchSize: number,
) {
  let inserted = 0;
  for (let start = 0; start < snapshots.length; start += batchSize) {
    const batch = snapshots.slice(start, start + batchSize);
    const output = psqlOutput(
      databaseUrl,
      `
WITH input AS (
  SELECT *
  FROM jsonb_to_recordset(${sqlJson(batch)}::jsonb) AS row(
    "mtgjsonUuid" text,
    provider text,
    finish text,
    "priceType" text,
    currency text,
    "observedDate" text,
    price numeric,
    "rawJson" jsonb
  )
),
inserted AS (
  INSERT INTO price_snapshots (
    mtgjson_uuid,
    provider,
    finish,
    price_type,
    currency,
    observed_date,
    price,
    raw_json
  )
  SELECT
    "mtgjsonUuid",
    provider,
    finish,
    "priceType",
    currency,
    "observedDate"::date,
    price,
    "rawJson"
  FROM input
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT count(*) FROM inserted;
`,
    );
    inserted += Number.parseInt(output || "0", 10) || 0;
  }
  return inserted;
}

function buildCurrentPriceProjection(
  snapshots: ReturnType<typeof extractMtgjsonPriceSnapshots>,
) {
  const byCard = new Map<string, Record<string, any>>();
  const latestKeys = new Map<string, string>();

  for (const snapshot of snapshots) {
    const key = [
      snapshot.mtgjsonUuid,
      snapshot.provider,
      snapshot.finish,
      snapshot.priceType,
      snapshot.currency,
    ].join("\u0000");
    const previousDate = latestKeys.get(key);
    if (previousDate && previousDate >= snapshot.observedDate) continue;
    latestKeys.set(key, snapshot.observedDate);

    const cardPrices = byCard.get(snapshot.mtgjsonUuid) || {};
    cardPrices[snapshot.provider] ||= {};
    cardPrices[snapshot.provider][snapshot.finish] ||= {};
    cardPrices[snapshot.provider][snapshot.finish][snapshot.priceType] ||= {};
    cardPrices[snapshot.provider][snapshot.finish][snapshot.priceType][
      snapshot.currency
    ] = {
      amount: snapshot.price,
      observedDate: snapshot.observedDate,
    };
    byCard.set(snapshot.mtgjsonUuid, cardPrices);
  }

  return Array.from(byCard, ([mtgjsonUuid, currentPrices]) => ({
    mtgjsonUuid,
    currentPrices,
  }));
}

function publishCurrentPrices(
  appDatabaseUrl: string | null,
  snapshots: ReturnType<typeof extractMtgjsonPriceSnapshots>,
) {
  if (!appDatabaseUrl || !snapshots.length) return 0;
  const rows = buildCurrentPriceProjection(snapshots);
  let updated = 0;
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const output = psqlOutput(
      appDatabaseUrl,
      `
WITH input AS (
  SELECT *
  FROM jsonb_to_recordset(${sqlJson(batch)}::jsonb) AS row(
    "mtgjsonUuid" text,
    "currentPrices" jsonb
  )
),
updated AS (
  UPDATE "Card" card
  SET prices = jsonb_set(
        COALESCE(card.prices::jsonb, '{}'::jsonb),
        '{mtgjson}',
        input."currentPrices",
        true
      ),
      "priceLastFetchedAt" = now()
  FROM input
  WHERE card."mtgjsonUuid" = input."mtgjsonUuid"
  RETURNING 1
)
SELECT count(*) FROM updated;
`,
    );
    updated += Number.parseInt(output || "0", 10) || 0;
  }
  return updated;
}

async function processRefreshAllJob(
  opts: WorkerOptions,
  runId: string,
  jobId: string,
) {
  log(
    opts.databaseUrl,
    runId,
    opts.workerId,
    "info",
    "Fetching MTGJSON prices.",
    {
      jobId,
      url: opts.mtgjsonAllPricesUrl,
      maxCards: opts.maxCards || null,
    },
  );
  const payload = await fetchMtgjsonAllPrices(opts);
  const snapshots = extractMtgjsonPriceSnapshots(payload, {
    defaultCurrency: opts.defaultCurrency,
    maxCards: opts.maxCards,
  });
  const inserted = insertSnapshots(
    opts.databaseUrl,
    snapshots,
    opts.importBatchSize,
  );
  const projected = publishCurrentPrices(opts.appDatabaseUrl, snapshots);
  completeJob(opts.databaseUrl, jobId, "SUCCEEDED", {
    processed: snapshots.length,
    inserted,
    skipped: snapshots.length - inserted,
  });
  log(
    opts.databaseUrl,
    runId,
    opts.workerId,
    "info",
    "Pricing job imported snapshots.",
    {
      jobId,
      processed: snapshots.length,
      inserted,
      skipped: snapshots.length - inserted,
      projected,
    },
  );
  return { processed: snapshots.length, inserted, projected };
}

async function runOnce(opts: WorkerOptions) {
  const runId = randomUUID();
  psql(
    opts.databaseUrl,
    `
INSERT INTO price_worker_runs (id, worker_id, status, message)
VALUES (${sqlString(runId)}, ${sqlString(opts.workerId)}, 'RUNNING', 'Pricing worker scaffold run started.');
`,
  );

  try {
    heartbeat(
      opts.databaseUrl,
      opts.workerId,
      "RUNNING",
      "Worker scaffold run active.",
    );
    log(
      opts.databaseUrl,
      runId,
      opts.workerId,
      "info",
      "Pricing worker scaffold run started.",
      {
        mtgjsonBaseUrl: process.env.MTGJSON_BASE_URL || null,
        redisUrlConfigured: Boolean(process.env.REDIS_URL),
      },
    );
    const jobs = claimQueuedJobs(opts.databaseUrl);
    let processedSnapshots = 0;
    let insertedSnapshots = 0;
    let projectedCards = 0;
    for (const job of jobs) {
      if (job.type !== "MTGJSON_REFRESH_ALL") {
        completeJob(
          opts.databaseUrl,
          job.id,
          "FAILED",
          { processed: 0, inserted: 0, skipped: 0 },
          `Unsupported pricing job type: ${job.type}`,
        );
        continue;
      }
      try {
        const result = await processRefreshAllJob(opts, runId, job.id);
        processedSnapshots += result.processed;
        insertedSnapshots += result.inserted;
        projectedCards += result.projected;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        completeJob(
          opts.databaseUrl,
          job.id,
          "FAILED",
          { processed: 0, inserted: 0, skipped: 0 },
          message,
        );
        log(
          opts.databaseUrl,
          runId,
          opts.workerId,
          "error",
          "Pricing job failed.",
          { jobId: job.id, jobType: job.type, error: message },
        );
      }
    }

    psql(
      opts.databaseUrl,
      `
UPDATE price_worker_runs
SET status = 'SUCCEEDED',
    finished_at = now(),
    message = ${sqlString(
      jobs.length
        ? `Pricing worker processed ${jobs.length} queued job(s), ${processedSnapshots} snapshots, ${insertedSnapshots} inserted, ${projectedCards} cards projected.`
        : "Pricing worker scaffold is healthy. Import processing will be added in a later phase.",
    )}
WHERE id = ${sqlString(runId)};
`,
    );
    heartbeat(
      opts.databaseUrl,
      opts.workerId,
      "IDLE",
      "Worker scaffold is healthy.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    psql(
      opts.databaseUrl,
      `
UPDATE price_worker_runs
SET status = 'FAILED',
    finished_at = now(),
    error = ${sqlString(message)}
WHERE id = ${sqlString(runId)};
`,
    );
    heartbeat(opts.databaseUrl, opts.workerId, "ERROR", message);
    log(opts.databaseUrl, runId, opts.workerId, "error", message);
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = options();
  console.log(
    `[pricing-worker] starting ${opts.workerId} with ${redactDatabaseUrl(opts.databaseUrl)}`,
  );
  initializeSchema(opts.databaseUrl);
  heartbeat(
    opts.databaseUrl,
    opts.workerId,
    "STARTING",
    "Worker initialized pricing schema.",
  );

  do {
    await runOnce(opts);
    if (opts.once) break;
    await sleep(opts.intervalMs);
  } while (true);
}

main().catch((error) => {
  console.error(
    "[pricing-worker]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
