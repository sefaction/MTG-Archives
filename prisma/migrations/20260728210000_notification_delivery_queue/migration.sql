CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED'
);

CREATE TYPE "NotificationDeliveryAttemptStatus" AS ENUM (
  'SENT',
  'FAILED'
);

CREATE TABLE "NotificationDeliveryJob" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "transport" TEXT NOT NULL,
  "destinationKey" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "claimToken" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDeliveryJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "NotificationDeliveryAttemptStatus" NOT NULL,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDeliveryJob_notificationId_transport_destinationKey_key"
  ON "NotificationDeliveryJob"("notificationId", "transport", "destinationKey");

CREATE INDEX "NotificationDeliveryJob_status_nextAttemptAt_idx"
  ON "NotificationDeliveryJob"("status", "nextAttemptAt");

CREATE INDEX "NotificationDeliveryJob_status_claimExpiresAt_idx"
  ON "NotificationDeliveryJob"("status", "claimExpiresAt");

CREATE INDEX "NotificationDeliveryJob_transport_status_createdAt_idx"
  ON "NotificationDeliveryJob"("transport", "status", "createdAt");

CREATE INDEX "NotificationDeliveryJob_notificationId_idx"
  ON "NotificationDeliveryJob"("notificationId");

CREATE UNIQUE INDEX "NotificationDeliveryAttempt_jobId_attemptNumber_key"
  ON "NotificationDeliveryAttempt"("jobId", "attemptNumber");

CREATE INDEX "NotificationDeliveryAttempt_status_finishedAt_idx"
  ON "NotificationDeliveryAttempt"("status", "finishedAt");

CREATE INDEX "NotificationDeliveryAttempt_jobId_finishedAt_idx"
  ON "NotificationDeliveryAttempt"("jobId", "finishedAt");

ALTER TABLE "NotificationDeliveryJob"
  ADD CONSTRAINT "NotificationDeliveryJob_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "NotificationDeliveryAttempt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "NotificationDeliveryJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
