import { processHourlyWishlistDigests } from "../lib/wishlist-notification-digests";
import {
  builtInNotificationDeliveryHandlers,
  processNotificationDeliveryQueue,
} from "../lib/notification-delivery";
import {
  deliverNotificationWebhook,
  WEBHOOK_TRANSPORT,
} from "../lib/webhook-delivery";

const deliveryHandlers = {
  ...builtInNotificationDeliveryHandlers,
  [WEBHOOK_TRANSPORT]: deliverNotificationWebhook,
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const intervalMs = positiveInteger(
  process.env.NOTIFICATION_WORKER_INTERVAL_MS,
  60_000,
);
const runOnce = process.argv.includes("--once");
let stopping = false;

async function tick() {
  try {
    const result = await processHourlyWishlistDigests();
    if (result.activitiesProcessed || result.notificationsCreated) {
      console.info("[notification-worker] wishlist digest complete", {
        cutoff: result.cutoff.toISOString(),
        activitiesProcessed: result.activitiesProcessed,
        notificationsCreated: result.notificationsCreated,
        groupsProcessed: result.groupsProcessed,
      });
    }
  } catch (error) {
    console.error(
      "[notification-worker] wishlist digest failed",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    const result = await processNotificationDeliveryQueue(deliveryHandlers);
    if (result.claimed) {
      console.info("[notification-worker] outbound delivery complete", result);
    }
  } catch (error) {
    console.error(
      "[notification-worker] outbound delivery failed",
      error instanceof Error ? error.message : error,
    );
  }
}

async function run() {
  console.info("[notification-worker] started", { intervalMs });
  if (runOnce) {
    await tick();
    return;
  }
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

void run();
