import { randomUUID } from "node:crypto";
import {
  NotificationDeliveryAttemptStatus,
  NotificationDeliveryStatus,
  type NotificationDeliveryJob,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ERROR_LENGTH = 2_000;

type DeliveryStore = Pick<
  PrismaClient,
  "$transaction" | "notificationDeliveryAttempt" | "notificationDeliveryJob"
>;

export type NotificationDeliveryHandlerContext = {
  idempotencyKey: string;
  notificationId: string | null;
  sourceType: string;
  sourceId: string;
  destinationKey: string;
  payload: Prisma.JsonValue;
};

export type NotificationDeliveryHandler = (
  context: NotificationDeliveryHandlerContext,
) => Promise<void>;

export type NotificationDeliveryHandlers = Record<
  string,
  NotificationDeliveryHandler
>;

export type DeliveryWorkerConfig = {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDeliveryWorkerConfig(): DeliveryWorkerConfig {
  return {
    batchSize: positiveInteger(
      process.env.NOTIFICATION_DELIVERY_BATCH_SIZE,
      20,
    ),
    leaseMs: positiveInteger(
      process.env.NOTIFICATION_DELIVERY_LEASE_MS,
      5 * 60_000,
    ),
    maxAttempts: positiveInteger(
      process.env.NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
      5,
    ),
    retryBaseMs: positiveInteger(
      process.env.NOTIFICATION_DELIVERY_RETRY_BASE_MS,
      60_000,
    ),
    retryMaxMs: positiveInteger(
      process.env.NOTIFICATION_DELIVERY_RETRY_MAX_MS,
      6 * 60 * 60_000,
    ),
  };
}

export function deliveryRetryAt(
  attemptNumber: number,
  now: Date,
  config: Pick<DeliveryWorkerConfig, "retryBaseMs" | "retryMaxMs">,
) {
  const exponent = Math.max(0, Math.floor(attemptNumber) - 1);
  const delay = Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** exponent);
  return new Date(now.getTime() + delay);
}

function requiredKey(value: string, field: string, maxLength = 160) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized.slice(0, maxLength);
}

async function enqueueDelivery(
  input: {
    notificationId?: string | null;
    sourceType: string;
    sourceId: string;
    transport: string;
    destinationKey: string;
    payload: Prisma.InputJsonValue;
    maxAttempts?: number;
  },
  store: Pick<Prisma.TransactionClient, "notificationDeliveryJob"> = prisma,
) {
  const config = getDeliveryWorkerConfig();
  const notificationId = input.notificationId
    ? requiredKey(input.notificationId, "Notification ID")
    : null;
  const sourceType = requiredKey(input.sourceType, "Delivery source type", 80);
  const sourceId = requiredKey(input.sourceId, "Delivery source ID", 160);
  const transport = requiredKey(input.transport, "Delivery transport", 80);
  const destinationKey = requiredKey(
    input.destinationKey,
    "Delivery destination",
    200,
  );
  return store.notificationDeliveryJob.upsert({
    where: {
      sourceType_sourceId_transport_destinationKey: {
        sourceType,
        sourceId,
        transport,
        destinationKey,
      },
    },
    update: {},
    create: {
      notificationId,
      sourceType,
      sourceId,
      transport,
      destinationKey,
      payloadJson: input.payload,
      maxAttempts: Math.max(
        1,
        Math.floor(input.maxAttempts ?? config.maxAttempts),
      ),
    },
  });
}

export async function enqueueNotificationDelivery(
  input: {
    notificationId: string;
    transport: string;
    destinationKey: string;
    payload: Prisma.InputJsonValue;
    maxAttempts?: number;
  },
  store: Pick<Prisma.TransactionClient, "notificationDeliveryJob"> = prisma,
) {
  return enqueueDelivery(
    {
      ...input,
      sourceType: "notification",
      sourceId: input.notificationId,
    },
    store,
  );
}

export async function enqueueEventDelivery(
  input: {
    sourceType: string;
    sourceId: string;
    transport: string;
    destinationKey: string;
    payload: Prisma.InputJsonValue;
    maxAttempts?: number;
  },
  store: Pick<Prisma.TransactionClient, "notificationDeliveryJob"> = prisma,
) {
  return enqueueDelivery(input, store);
}

type ClaimedDelivery = NotificationDeliveryJob & {
  notification: {
    recipientUserId: string;
    type: string;
    category: string;
  } | null;
};

export async function claimNotificationDeliveries(
  now = new Date(),
  workerId: string = randomUUID(),
  config = getDeliveryWorkerConfig(),
  store: DeliveryStore = prisma,
): Promise<ClaimedDelivery[]> {
  const leaseExpiresAt = new Date(now.getTime() + config.leaseMs);
  const candidates = await store.notificationDeliveryJob.findMany({
    where: {
      OR: [
        {
          status: {
            in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.FAILED,
            ],
          },
          nextAttemptAt: { lte: now },
        },
        {
          status: NotificationDeliveryStatus.SENDING,
          claimExpiresAt: { lte: now },
        },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: Math.max(config.batchSize * 3, config.batchSize),
    select: { id: true },
  });

  const claimed: ClaimedDelivery[] = [];
  for (const candidate of candidates) {
    if (claimed.length >= config.batchSize) break;
    const claimToken = `${workerId}:${randomUUID()}`;
    const updated = await store.notificationDeliveryJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          {
            status: {
              in: [
                NotificationDeliveryStatus.PENDING,
                NotificationDeliveryStatus.FAILED,
              ],
            },
            nextAttemptAt: { lte: now },
          },
          {
            status: NotificationDeliveryStatus.SENDING,
            claimExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: NotificationDeliveryStatus.SENDING,
        claimToken,
        claimedAt: now,
        claimExpiresAt: leaseExpiresAt,
      },
    });
    if (updated.count !== 1) continue;
    const job = await store.notificationDeliveryJob.findUnique({
      where: { id: candidate.id },
      include: {
        notification: {
          select: { recipientUserId: true, type: true, category: true },
        },
      },
    });
    if (job) claimed.push(job);
  }
  return claimed;
}

function errorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown delivery failure.";
  return message.trim().slice(0, MAX_ERROR_LENGTH) || "Delivery failed.";
}

async function finishDelivery(
  job: ClaimedDelivery,
  startedAt: Date,
  finishedAt: Date,
  error: unknown | null,
  config: DeliveryWorkerConfig,
  store: DeliveryStore,
) {
  const attemptNumber = job.attemptCount + 1;
  const failed = error !== null;
  const exhausted = failed && attemptNumber >= job.maxAttempts;
  const retryAt =
    failed && !exhausted
      ? deliveryRetryAt(attemptNumber, finishedAt, config)
      : null;
  const message = failed ? errorMessage(error) : null;

  return store.$transaction(async (tx) => {
    const updated = await tx.notificationDeliveryJob.updateMany({
      where: {
        id: job.id,
        status: NotificationDeliveryStatus.SENDING,
        claimToken: job.claimToken,
      },
      data: {
        status: failed
          ? NotificationDeliveryStatus.FAILED
          : NotificationDeliveryStatus.SENT,
        attemptCount: attemptNumber,
        nextAttemptAt: retryAt,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError: message,
        sentAt: failed ? null : finishedAt,
      },
    });
    if (updated.count !== 1) return false;
    await tx.notificationDeliveryAttempt.create({
      data: {
        jobId: job.id,
        attemptNumber,
        status: failed
          ? NotificationDeliveryAttemptStatus.FAILED
          : NotificationDeliveryAttemptStatus.SENT,
        errorMessage: message,
        startedAt,
        finishedAt,
      },
    });
    return true;
  });
}

export async function processNotificationDeliveryQueue(
  handlers: NotificationDeliveryHandlers,
  now = new Date(),
  store: DeliveryStore = prisma,
  config = getDeliveryWorkerConfig(),
) {
  const jobs = await claimNotificationDeliveries(
    now,
    randomUUID(),
    config,
    store,
  );
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const startedAt = new Date();
    let failure: unknown | null = null;
    try {
      const handler = handlers[job.transport];
      if (!handler) {
        throw new Error(
          `No notification delivery handler is registered for "${job.transport}".`,
        );
      }
      await handler({
        idempotencyKey: job.id,
        notificationId: job.notificationId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        destinationKey: job.destinationKey,
        payload: job.payloadJson,
      });
    } catch (error) {
      failure = error;
    }
    const recorded = await finishDelivery(
      job,
      startedAt,
      new Date(),
      failure,
      config,
      store,
    );
    if (!recorded) continue;
    if (failure) failed += 1;
    else sent += 1;
  }
  return { claimed: jobs.length, sent, failed };
}

export const builtInNotificationDeliveryHandlers: NotificationDeliveryHandlers =
  {
    diagnostic: async ({ idempotencyKey, destinationKey, payload }) => {
      const shouldFail =
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload) &&
        payload.mode === "fail";
      if (shouldFail) throw new Error("Requested diagnostic delivery failure.");
      console.info("[notification-worker] diagnostic delivery", {
        idempotencyKey,
        destinationKey,
      });
    },
  };

export async function getNotificationDeliveryHealth() {
  const [counts, recentJobs] = await Promise.all([
    prisma.notificationDeliveryJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.notificationDeliveryJob.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 30,
      include: {
        notification: {
          select: {
            title: true,
            recipientUser: {
              select: { displayName: true, username: true },
            },
          },
        },
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 5,
        },
      },
    }),
  ]);
  const byStatus = Object.fromEntries(
    Object.values(NotificationDeliveryStatus).map((status) => [status, 0]),
  ) as Record<NotificationDeliveryStatus, number>;
  for (const row of counts) byStatus[row.status] = row._count._all;
  return { byStatus, recentJobs };
}
