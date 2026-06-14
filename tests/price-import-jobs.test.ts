import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  claimNextPriceImportJob,
  createPriceImportJob,
  isPriceWorkerHeartbeatFresh,
  isPriceImportJobType,
  listPriceImportJobs,
  runPriceImportJob,
  updatePriceWorkerHeartbeat,
} from "../lib/price-import-jobs";

function mockJobDb() {
  const jobs: any[] = [];
  const heartbeats: any[] = [];
  return {
    jobs,
    heartbeats,
    priceImportJob: {
      async findFirst({ where }: any = {}) {
        return (
          jobs
            .filter((job) =>
              where?.status?.in
                ? where.status.in.includes(job.status)
                : where?.status
                  ? job.status === where.status
                  : true,
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ||
          null
        );
      },
      async create({ data }: any) {
        const job = {
          id: `job-${jobs.length + 1}`,
          ...data,
          createdAt: new Date(Date.UTC(2026, 5, 14, 0, jobs.length)),
          updatedAt: new Date(Date.UTC(2026, 5, 14, 0, jobs.length)),
        };
        jobs.push(job);
        return job;
      },
      async findMany({ take }: any = {}) {
        return [...jobs]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take || 10);
      },
      async updateMany({ where, data }: any) {
        const job = jobs.find(
          (candidate) =>
            candidate.id === where.id && candidate.status === where.status,
        );
        if (!job) return { count: 0 };
        Object.assign(job, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      async findUnique({ where }: any) {
        return jobs.find((job) => job.id === where.id) || null;
      },
      async update({ where, data }: any) {
        const job = jobs.find((candidate) => candidate.id === where.id);
        Object.assign(job, data, { updatedAt: new Date() });
        return job;
      },
    },
    priceWorkerHeartbeat: {
      async upsert({ where, update, create }: any) {
        let heartbeat = heartbeats.find(
          (candidate) => candidate.workerId === where.workerId,
        );
        if (heartbeat) {
          Object.assign(heartbeat, update, { updatedAt: new Date() });
          return heartbeat;
        }
        heartbeat = {
          id: `heartbeat-${heartbeats.length + 1}`,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        heartbeats.push(heartbeat);
        return heartbeat;
      },
      async findMany({ take }: any = {}) {
        return [...heartbeats]
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
          .slice(0, take || 5);
      },
    },
  } as any;
}

test("price import jobs validate supported types", () => {
  assert.equal(isPriceImportJobType("map_mtgjson_cards"), true);
  assert.equal(isPriceImportJobType("import_prices_today"), true);
  assert.equal(isPriceImportJobType("import_prices_history"), true);
  assert.equal(isPriceImportJobType("delete_everything"), false);
});

test("creating jobs stores queued status and prevents duplicate active jobs", async () => {
  const db = mockJobDb();
  const first = await createPriceImportJob("import_prices_today", "user-1", db);
  const second = await createPriceImportJob("import_prices_history", "user-1", db);
  assert.equal(first.existing, false);
  assert.equal(first.job.status, "queued");
  assert.equal(first.job.requestedById, "user-1");
  assert.equal(second.existing, true);
  assert.equal(second.job.id, first.job.id);
  assert.equal(db.jobs.length, 1);
  assert.equal((await listPriceImportJobs(db, 5)).length, 1);
});

test("worker claims a queued job atomically", async () => {
  const db = mockJobDb();
  await createPriceImportJob("map_mtgjson_cards", "user-1", db);
  const claimed = await claimNextPriceImportJob("worker-a", db);
  const secondClaim = await claimNextPriceImportJob("worker-b", db);
  assert.equal(claimed?.status, "running");
  assert.equal((claimed?.progressJson as any).workerId, "worker-a");
  assert.equal(secondClaim, null);
});

test("worker heartbeat is created, updated, and classified by freshness", async () => {
  const db = mockJobDb();
  const first = await updatePriceWorkerHeartbeat("worker-a", db);
  const second = await updatePriceWorkerHeartbeat("worker-a", db);
  assert.equal(db.heartbeats.length, 1);
  assert.equal(first.workerId, "worker-a");
  assert.equal(second.workerId, "worker-a");
  assert.equal(isPriceWorkerHeartbeatFresh(second), true);
  assert.equal(
    isPriceWorkerHeartbeatFresh(
      { lastSeenAt: new Date(Date.now() - 3 * 60 * 1000) },
      new Date(),
    ),
    false,
  );
});

test("price worker script can be imported without starting the loop", async () => {
  process.env.PRICE_WORKER_TEST_MODE = "true";
  const workerModule = await import("../scripts/price-worker");
  assert.equal(typeof workerModule.startPriceWorker, "function");
  assert.equal(typeof workerModule.sleep, "function");
});

test("worker marks unsupported claimed jobs as failed with an error", async () => {
  const db = mockJobDb();
  db.jobs.push({ id: "job-bad", type: "unknown", status: "running", createdAt: new Date() });
  await assert.rejects(() => runPriceImportJob(db.jobs[0], db), /Unsupported/);
  assert.equal(db.jobs[0].status, "failed");
  assert.match(db.jobs[0].errorMessage, /Unsupported/);
});

test("admin pricing page and worker source expose background job workflow", () => {
  const adminPage = readFileSync("app/admin/prices/page.tsx", "utf8");
  const jobsRoute = readFileSync("app/api/admin/prices/jobs/route.ts", "utf8");
  const worker = readFileSync("scripts/price-worker.ts", "utf8");
  const compose = readFileSync("docker-compose.yml", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(adminPage, /Import today(&apos;|')s prices/);
  assert.match(adminPage, /Backfill price history/);
  assert.match(adminPage, /Price worker:/);
  assert.match(adminPage, /No price worker is online/);
  assert.match(adminPage, /PriceImportJobsPanel/);
  assert.match(jobsRoute, /createPriceImportJob/);
  assert.match(jobsRoute, /listPriceImportJobs/);
  assert.match(jobsRoute, /listPriceWorkerHeartbeats/);
  assert.match(worker, /updatePriceWorkerHeartbeat/);
  assert.match(worker, /polling for queued jobs/);
  assert.match(worker, /PRICE_WORKER_TEST_MODE/);
  assert.match(worker, /runOnePriceImportJob/);
  assert.equal(packageJson.scripts["worker:prices"], "tsx scripts/price-worker.ts");
  assert.match(dockerfile, /COPY --from=builder \/app\/scripts \.\/scripts/);
  assert.match(dockerfile, /COPY --from=builder \/app\/lib \.\/lib/);
  assert.match(dockerfile, /COPY --from=builder \/app\/tsconfig\.json \.\/tsconfig\.json/);
  assert.match(compose, /price-worker:/);
  assert.match(compose, /command: npm run worker:prices/);
  assert.match(compose, /PRICE_WORKER_HEARTBEAT_INTERVAL_MS/);
});
