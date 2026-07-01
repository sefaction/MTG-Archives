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
      "-c",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "psql command failed",
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

export async function listPricingWorkerStatus(): Promise<PricingWorkerStatus> {
  try {
    const [stats] = jsonQuery<PricingWorkerStatus["stats"]>(
      `SELECT
         COUNT(*)::int AS "snapshotCount",
         COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
         MAX(observed_date)::text AS "latestObservedDate",
         MAX(ingested_at)::text AS "latestIngestedAt",
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
  const id = randomUUID();
  runPsql(
    `INSERT INTO price_import_jobs (id, type, status, requested_by, payload_json)
     VALUES (
       ${sqlString(id)},
       'MTGJSON_REFRESH_ALL',
       'QUEUED',
       ${sqlString(requestedBy)},
       '{"source":"admin"}'::jsonb
     );`,
  );
  return id;
}
