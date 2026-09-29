export const ACQUISITION_UPLOAD_ATTEMPTS = 3;

// Only database conflicts already retried by acquisition-store may be marked
// transient. Do not infer this from error text or ordinary domain conflicts.
export function isRetryableAcquisitionConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  return Boolean(
    meta && typeof meta === "object" && "code" in meta &&
    ["40001", "40P01"].includes(String(meta.code)),
  );
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, delay);
    signal.addEventListener("abort", stop, { once: true });
  });
}

type UploadOptions = {
  signal: AbortSignal;
  onRetry?: (retry: number) => void;
  request?: typeof fetch;
  wait?: typeof wait;
  random?: () => number;
};

// The caller persists the blob before this operation and clears it only after
// success. Keep the exact URL, bytes and overall deadline across every attempt.
export async function uploadAcquisitionPhoto(
  url: string,
  blob: Blob,
  { signal, onRetry, request = fetch, wait: delay = wait, random = Math.random }: UploadOptions,
) {
  for (let attempt = 0; attempt < ACQUISITION_UPLOAD_ATTEMPTS; attempt++) {
    if (signal.aborted) throw signal.reason;
    let response: Response | undefined;
    let failure: unknown;
    let retryable = false;
    try {
      response = await request(url, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
        signal,
      });
    } catch (error) {
      failure = error;
      retryable = error instanceof TypeError;
    }
    if (response) {
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ready === true) return;
      failure = new Error(
        typeof result?.error === "string" ? result.error : "Upload was not saved; retry",
      );
      retryable =
        (response.status === 409 && result?.retryable === true) ||
        [408, 502, 503, 504].includes(response.status);
    }
    if (signal.aborted) throw signal.reason;
    if (!retryable || attempt === ACQUISITION_UPLOAD_ATTEMPTS - 1) throw failure;
    onRetry?.(attempt + 1);
    await delay(Math.round(500 * 2 ** attempt * (1 + random() / 2)), signal);
  }
}
