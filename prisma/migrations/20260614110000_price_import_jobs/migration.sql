CREATE TABLE "PriceImportJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedById" TEXT,
    "source" TEXT,
    "provider" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "progressJson" JSONB,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceImportJob_status_createdAt_idx" ON "PriceImportJob"("status", "createdAt");
CREATE INDEX "PriceImportJob_type_createdAt_idx" ON "PriceImportJob"("type", "createdAt");

ALTER TABLE "PriceImportJob" ADD CONSTRAINT "PriceImportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
