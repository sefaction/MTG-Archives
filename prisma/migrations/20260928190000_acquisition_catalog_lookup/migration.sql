CREATE TABLE "AcquisitionCatalogLookup" (
    "key" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionCatalogLookup_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AcquisitionCatalogLookup_status_leaseExpiresAt_idx" ON "AcquisitionCatalogLookup"("status", "leaseExpiresAt");
