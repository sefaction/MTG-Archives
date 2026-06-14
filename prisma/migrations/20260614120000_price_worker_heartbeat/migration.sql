CREATE TABLE "PriceWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "hostname" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceWorkerHeartbeat_workerId_key" ON "PriceWorkerHeartbeat"("workerId");
CREATE INDEX "PriceWorkerHeartbeat_lastSeenAt_idx" ON "PriceWorkerHeartbeat"("lastSeenAt");
