import { spawn } from "node:child_process";

/** Bounded, read-only asynchronous queries for the admin health/coverage path. */
export async function queryPricingJson<T>(
  sql: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<T[]> {
  const configured = process.env.PRICING_DATABASE_URL;
  if (!configured) throw new Error("Pricing database is not configured.");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Pricing database configuration is invalid.");
  }
  url.searchParams.delete("schema");
  const limit = Math.max(50, Math.min(60_000, Math.trunc(timeoutMs)));
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "psql",
      [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PGCONNECT_TIMEOUT: "5",
          PGOPTIONS: `-c statement_timeout=${limit} -c default_transaction_read_only=on`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "",
      bytes = 0,
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, limit + 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > 8 * 1024 * 1024) {
        child.kill("SIGKILL");
        return;
      }
      output += chunk;
    });
    // PostgreSQL/child-process errors can contain connection details. Never
    // return stderr, executable arguments or raw SQL to the browser.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Pricing database request could not start."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            timedOut
              ? "Pricing database request timed out. Try again later."
              : "Pricing database request failed or exceeded its time limit. Check worker health and try again.",
          ),
        );
      else resolve(output);
    });
    child.stdin.end(
      `SELECT COALESCE(json_agg(row_to_json(rows)), '[]'::json) FROM (${sql}) rows;`,
    );
  });
  try {
    return JSON.parse(output || "[]") as T[];
  } catch {
    throw new Error("Pricing database returned an invalid response.");
  }
}

export type PricingHistoryTotals = {
  snapshotCount: number;
  pricedCardCount: number;
  latestObservedDate: string | null;
  latestIngestedAt: string | null;
  calculatedAt: string;
};
let totalsCache: PricingHistoryTotals | undefined;
let pendingTotals: Promise<PricingHistoryTotals> | undefined;

/** Share one expensive scan among concurrent admin requests, cached five minutes. */
export function getPricingHistoryTotals() {
  if (
    totalsCache &&
    Date.now() - Date.parse(totalsCache.calculatedAt) < 300_000
  )
    return Promise.resolve(totalsCache);
  if (pendingTotals) return pendingTotals;
  pendingTotals = queryPricingJson<Omit<PricingHistoryTotals, "calculatedAt">>(`
    SELECT COUNT(*)::int AS "snapshotCount", COUNT(DISTINCT mtgjson_uuid)::int AS "pricedCardCount",
      MAX(observed_date)::text AS "latestObservedDate", MAX(created_at)::text AS "latestIngestedAt"
    FROM price_snapshots
  `)
    .then((rows) => {
      if (!rows[0]) throw new Error("Pricing history totals are unavailable.");
      totalsCache = { ...rows[0], calculatedAt: new Date().toISOString() };
      return totalsCache;
    })
    .finally(() => {
      pendingTotals = undefined;
    });
  return pendingTotals;
}
