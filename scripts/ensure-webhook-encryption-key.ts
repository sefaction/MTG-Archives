import { ensureWebhookEncryptionKey } from "../lib/webhook-encryption-key";

const result = ensureWebhookEncryptionKey();
console.info(
  `[webhook-key] ${result.created ? "generated" : "ready"}: ${result.path}`,
);
