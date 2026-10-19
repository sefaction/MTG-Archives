import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

type Readiness = "READY" | "REJECTING" | "NO_RESPONSE";
type Dependencies = {
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  probe: (url: string, timeoutMs: number) => Readiness;
  report: (event: { event: "pricing-database-wait" | "pricing-database-ready"; attempt: number; elapsedMs: number; status: Readiness }) => void;
  timeoutMs: number;
};

function probe(url: string, timeoutMs: number): Readiness {
  const result = spawnSync("pg_isready", ["--dbname", url, "--quiet", "--timeout", "2"], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 4096,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return "NO_RESPONSE";
  if (!result.error && result.status === 0) return "READY";
  if (!result.error && result.status === 1) return "REJECTING";
  if (!result.error && result.status === 2) return "NO_RESPONSE";
  // Never include the connection string or untrusted command output in diagnostics.
  throw new Error("Pricing database readiness command failed.");
}

/** Wait only before starting work; never replay a SQL write or an in-flight job. */
export async function waitForPricingDatabase(databaseUrl: string, overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { now: Date.now, sleep, probe, report: event => console.log(JSON.stringify(event)), timeoutMs: 180000, ...overrides };
  if (!Number.isFinite(deps.timeoutMs) || deps.timeoutMs <= 0) throw new Error("Invalid pricing database readiness budget.");
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("schema");
  const started = deps.now(), deadline = started + deps.timeoutMs;
  let attempts = 0, delayMs = 1000, waiting = false;
  while (deps.now() < deadline) {
    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    const status = deps.probe(parsed.toString(), Math.min(2000, remaining));
    attempts++;
    if (status === "READY") {
      if (waiting) deps.report({ event: "pricing-database-ready", attempt: attempts, elapsedMs: deps.now() - started, status });
      return;
    }
    if (!waiting) deps.report({ event: "pricing-database-wait", attempt: attempts, elapsedMs: deps.now() - started, status });
    waiting = true;
    await deps.sleep(Math.max(0, Math.min(delayMs, deadline - deps.now())));
    delayMs = Math.min(delayMs * 2, 10000);
  }
  throw new Error("Pricing database did not become ready within the startup budget.");
}
