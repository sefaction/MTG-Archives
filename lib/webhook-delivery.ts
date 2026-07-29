import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Prisma } from "@prisma/client";
import {
  enqueueNotificationDelivery,
  type NotificationDeliveryHandler,
} from "@/lib/notification-delivery";
import { prisma } from "@/lib/prisma";
import { loadWebhookEncryptionKey } from "@/lib/webhook-encryption-key";

export const WEBHOOK_TRANSPORT = "webhook";
export const WEBHOOK_PAYLOAD_VERSION = "1";
export const WEBHOOK_NOTIFICATION_CATEGORIES = [
  "trades",
  "wishlist_digest",
] as const;

const MAX_URL_LENGTH = 2_048;
const MAX_RESPONSE_BYTES = 16 * 1_024;
const DEFAULT_TIMEOUT_MS = 8_000;
const ENCRYPTED_VALUE_VERSION = "v1";

const alwaysBlocked = new BlockList();
alwaysBlocked.addSubnet("0.0.0.0", 8, "ipv4");
alwaysBlocked.addSubnet("127.0.0.0", 8, "ipv4");
alwaysBlocked.addSubnet("169.254.0.0", 16, "ipv4");
alwaysBlocked.addSubnet("224.0.0.0", 4, "ipv4");
alwaysBlocked.addSubnet("240.0.0.0", 4, "ipv4");
alwaysBlocked.addAddress("::", "ipv6");
alwaysBlocked.addAddress("::1", "ipv6");
alwaysBlocked.addSubnet("fe80::", 10, "ipv6");
alwaysBlocked.addSubnet("ff00::", 8, "ipv6");

const privateBlocked = new BlockList();
privateBlocked.addSubnet("10.0.0.0", 8, "ipv4");
privateBlocked.addSubnet("100.64.0.0", 10, "ipv4");
privateBlocked.addSubnet("172.16.0.0", 12, "ipv4");
privateBlocked.addSubnet("192.168.0.0", 16, "ipv4");
privateBlocked.addSubnet("198.18.0.0", 15, "ipv4");
privateBlocked.addSubnet("fc00::", 7, "ipv6");

const blockedHostnames = new Set([
  "localhost",
  "metadata.amazonaws.com",
  "metadata.google.internal",
]);

export function webhookEncryptionAvailable() {
  try {
    loadWebhookEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptWebhookValue(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error("Encrypted webhook value is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadWebhookEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_VALUE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptWebhookValue(value: string) {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (
    version !== ENCRYPTED_VALUE_VERSION ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra
  ) {
    throw new Error("Encrypted webhook value is invalid.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      loadWebhookEncryptionKey(),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Webhook credentials could not be decrypted with the configured key.",
    );
  }
}

export function webhookSecretHint(secret: string) {
  const normalized = secret.trim();
  return `••••${normalized.slice(-4)}`;
}

export function validateWebhookUrlSyntax(
  value: string,
  allowPrivateNetwork: boolean,
) {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_URL_LENGTH) {
    throw new Error(
      "Webhook URL is required and must be 2,048 characters or fewer.",
    );
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Webhook URL is invalid.");
  }
  const allowedProtocols = allowPrivateNetwork
    ? ["https:", "http:"]
    : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(
      allowPrivateNetwork
        ? "Webhook URL must use HTTP or HTTPS."
        : "Public webhook URLs must use HTTPS.",
    );
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error(
      "Webhook URLs cannot include embedded usernames or passwords.",
    );
  }
  if (url.hash) throw new Error("Webhook URLs cannot include fragments.");
  return url;
}

export function webhookUrlHint(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/…`;
}

function addressBlocked(
  address: string,
  family: 4 | 6,
  allowPrivateNetwork: boolean,
) {
  const type = family === 4 ? "ipv4" : "ipv6";
  return (
    (family === 6 && address.toLowerCase().startsWith("::ffff:")) ||
    alwaysBlocked.check(address, type) ||
    (!allowPrivateNetwork && privateBlocked.check(address, type))
  );
}

export async function resolveWebhookTarget(
  input: string,
  allowPrivateNetwork: boolean,
) {
  const url = validateWebhookUrlSyntax(input, allowPrivateNetwork);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    (!allowPrivateNetwork && hostname.endsWith(".local"))
  ) {
    throw new Error("Webhook destination hostname is blocked.");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length)
    throw new Error("Webhook destination did not resolve.");
  for (const result of addresses) {
    const family: 4 | 6 = result.family === 6 ? 6 : 4;
    if (addressBlocked(result.address, family, allowPrivateNetwork)) {
      throw new Error(
        allowPrivateNetwork
          ? "Webhook destination resolves to a blocked local or link-local address."
          : "Webhook destination resolves to a private or blocked address.",
      );
    }
  }
  return {
    url,
    address: {
      address: addresses[0].address,
      family: addresses[0].family === 6 ? (6 as const) : (4 as const),
    },
  };
}

export function buildWebhookPayload(input: {
  notificationId: string;
  type: string;
  category: string;
  title: string;
  message: string | null;
  href: string | null;
  createdAt: Date;
  test?: boolean;
}): Prisma.InputJsonObject {
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    event: input.test ? "notification.test" : "notification.created",
    createdAt: input.createdAt.toISOString(),
    test: Boolean(input.test),
    notification: {
      id: input.notificationId,
      type: input.type,
      category: input.category,
      title: input.title,
      message: input.message,
      href: input.href,
    },
  };
}

export function webhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function createPinnedLookup(address: {
  address: string;
  family: 4 | 6;
}): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

type WebhookEnqueueStore = Pick<
  Prisma.TransactionClient,
  | "notificationDeliveryJob"
  | "notificationPreference"
  | "notificationWebhookEndpoint"
>;

export async function enqueueWebhookDeliveriesForNotification(
  notification: {
    id: string;
    recipientUserId: string;
    type: string;
    category: string;
    title: string;
    message: string | null;
    href: string | null;
    createdAt: Date;
  },
  store: WebhookEnqueueStore = prisma,
) {
  const preference = await store.notificationPreference.findUnique({
    where: {
      userId_category: {
        userId: notification.recipientUserId,
        category: notification.category,
      },
    },
    select: { webhookEnabled: true },
  });
  if (preference?.webhookEnabled !== true) return [];
  const endpoints = await store.notificationWebhookEndpoint.findMany({
    where: { userId: notification.recipientUserId, enabled: true },
    select: { id: true },
  });
  const payload = buildWebhookPayload({
    notificationId: notification.id,
    type: notification.type,
    category: notification.category,
    title: notification.title,
    message: notification.message,
    href: notification.href,
    createdAt: notification.createdAt,
  });
  return Promise.all(
    endpoints.map((endpoint) =>
      enqueueNotificationDelivery(
        {
          notificationId: notification.id,
          transport: WEBHOOK_TRANSPORT,
          destinationKey: endpoint.id,
          payload,
        },
        store,
      ),
    ),
  );
}

function payloadIsTest(payload: Prisma.JsonValue) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    payload.test === true
  );
}

async function postWebhook(input: {
  url: string;
  allowPrivateNetwork: boolean;
  secret: string;
  idempotencyKey: string;
  payload: Prisma.JsonValue;
  timeoutMs?: number;
}) {
  const target = await resolveWebhookTarget(
    input.url,
    input.allowPrivateNetwork,
  );
  const body = JSON.stringify(input.payload);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = webhookSignature(input.secret, timestamp, body);
  const request = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const req = request(
      target.url,
      {
        method: "POST",
        agent: false,
        maxHeaderSize: 16 * 1_024,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "MTG-Archives-Webhook/1",
          "X-MTG-Archives-Webhook-Id": input.idempotencyKey,
          "X-MTG-Archives-Webhook-Timestamp": timestamp,
          "X-MTG-Archives-Webhook-Signature": `v1=${signature}`,
        },
        lookup: createPinnedLookup(target.address),
      },
      (response) => {
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy(
              new Error("Webhook response exceeded the 16 KiB limit."),
            );
          }
        });
        response.on("error", (error) => finish(error));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            finish(new Error(`Webhook returned HTTP ${status}.`));
          } else {
            finish();
          }
        });
      },
    );
    req.setTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      req.destroy(new Error("Webhook request timed out."));
    });
    req.on("error", (error) => finish(error));
    req.end(body);
  });
}

export const deliverNotificationWebhook: NotificationDeliveryHandler = async ({
  idempotencyKey,
  destinationKey,
  payload,
}) => {
  const endpoint = await prisma.notificationWebhookEndpoint.findUnique({
    where: { id: destinationKey },
    select: {
      enabled: true,
      allowPrivateNetwork: true,
      urlEncrypted: true,
      secretEncrypted: true,
    },
  });
  if (!endpoint) throw new Error("Webhook endpoint no longer exists.");
  if (!endpoint.enabled && !payloadIsTest(payload)) {
    throw new Error("Webhook endpoint is disabled.");
  }
  await postWebhook({
    url: decryptWebhookValue(endpoint.urlEncrypted),
    allowPrivateNetwork: endpoint.allowPrivateNetwork,
    secret: decryptWebhookValue(endpoint.secretEncrypted),
    idempotencyKey,
    payload,
  });
};
