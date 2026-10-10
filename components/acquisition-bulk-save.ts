export class BulkReviewUncertainError extends Error {
  constructor() {
    super("Confirmation is uncertain. Continue the original confirmations after checking your connection and saving or cancelling any new correction.");
  }
}

/** Retry only an interrupted transport, with the identical revision-fenced body. */
export async function saveBulkReview(endpoint: string, body: string, canRetry: () => boolean,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const send = options.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt && !canRetry()) throw new BulkReviewUncertainError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    let response: Response;
    try {
      response = await send(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
    } catch {
      if (attempt) throw new BulkReviewUncertainError();
      continue;
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      let message = "Review changed; reload this match";
      try { const result = await response.json(); if (typeof result.error === "string") message = result.error; } catch { /* Status is known; do not retry a rejection. */ }
      throw new Error(message);
    }
    return;
  }
}
