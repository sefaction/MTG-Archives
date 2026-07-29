import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const KEY_BYTES = 32;
const KEY_FILENAME = "notification-webhook.key";
const SECRET_DIRECTORY = ".system-secrets";

type WebhookKeyEnvironment = Record<string, string | undefined>;

function configuredKey(
  env: WebhookKeyEnvironment,
): { key: Buffer } | null {
  const value = env.NOTIFICATION_WEBHOOK_ENCRYPTION_KEY?.trim();
  if (!value) return null;
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      "NOTIFICATION_WEBHOOK_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return { key };
}

export function webhookEncryptionKeyPath(
  env: WebhookKeyEnvironment = process.env,
) {
  const backupDirectory =
    env.BACKUP_DIR?.trim() ||
    env.BACKUPS_DATA_PATH?.trim() ||
    "/app/backups";
  return join(backupDirectory, SECRET_DIRECTORY, KEY_FILENAME);
}

function parseKeyFile(value: string, path: string) {
  const encoded = value.trim();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`Webhook encryption key file is invalid: ${path}`);
  }
  return key;
}

export function loadWebhookEncryptionKey(
  env: WebhookKeyEnvironment = process.env,
) {
  const override = configuredKey(env);
  if (override) return override.key;
  const path = webhookEncryptionKeyPath(env);
  try {
    return parseKeyFile(readFileSync(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Webhook encryption is unavailable. The generated key file is missing: ${path}`,
      );
    }
    throw error;
  }
}

export function ensureWebhookEncryptionKey(
  env: WebhookKeyEnvironment = process.env,
) {
  const path = webhookEncryptionKeyPath(env);
  const override = configuredKey(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);

  if (existsSync(path)) {
    const key = parseKeyFile(readFileSync(path, "utf8"), path);
    if (override && !key.equals(override.key)) {
      throw new Error(
        "The configured webhook encryption key does not match the persistent key file.",
      );
    }
    chmodSync(path, 0o600);
    return { created: false, path, key };
  }

  const key = override?.key ?? randomBytes(KEY_BYTES);
  const encoded = `${key.toString("base64")}\n`;
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, encoded, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (!existsSync(path)) renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const persistedKey = parseKeyFile(readFileSync(path, "utf8"), path);
  if (!persistedKey.equals(key)) {
    throw new Error(
      "A different webhook encryption key was generated concurrently.",
    );
  }
  chmodSync(path, 0o600);
  return { created: true, path, key: persistedKey };
}
