export const ACQUISITION_UPLOAD_ATTEMPTS = 3;

/** Break synchronized database retry waves without increasing the existing cap. */
export function acquisitionConflictBackoff(attempt: number, random = Math.random) {
  return Math.round(15 * 2 ** attempt * (0.5 + 0.5 * random()));
}

export type AcquisitionUploadPhase = "AUTHORIZE" | "CHECK_SLOT" | "READ_BODY" | "INSPECT" | "BEGIN" | "WRITE" | "FINALIZE";
export function acquisitionUploadFailureDiagnostic(error: unknown, phase: AcquisitionUploadPhase) {
  const value=error && typeof error==='object' ? error as {code?:unknown;meta?:{code?:unknown}} : null;
  const code=typeof value?.code==='string' && /^P\d{4}$/.test(value.code) ? value.code : "UNCLASSIFIED";
  const state=String(value?.meta?.code??'');
  return {event:"ACQUISITION_UPLOAD_FAILURE",phase,code,
    ...(["40001","40P01","23505"].includes(state) ? {sqlState:state} : {}),
    retryable:isRetryableAcquisitionConflict(error)};
}

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

async function postWithRetry<T>(
  url: string,
  body: Blob | string,
  contentType: string,
  acknowledged: (value: any) => boolean,
  fallback: string,
  { signal, onRetry, request = fetch, wait: delay = wait, random = Math.random }: UploadOptions,
): Promise<T> {
  for (let attempt = 0; attempt < ACQUISITION_UPLOAD_ATTEMPTS; attempt++) {
    if (signal.aborted) throw signal.reason;
    let response: Response | undefined;
    let failure: unknown;
    let retryable = false;
    try {
      response = await request(url, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
        signal,
      });
    } catch (error) {
      failure = error;
      retryable = error instanceof TypeError;
    }
    if (response) {
      let result;
      let bodyDisconnected = false;
      try {
        result = await response.json();
      } catch (error) {
        bodyDisconnected = error instanceof TypeError;
      }
      if (response.ok && acknowledged(result)) return result as T;
      failure = new Error(
        typeof result?.error === "string" ? result.error : fallback,
      );
      retryable =
        (response.ok && bodyDisconnected) ||
        (response.status === 409 && result?.retryable === true) ||
        [408, 502, 503, 504].includes(response.status);
    }
    if (signal.aborted) throw signal.reason;
    if (!retryable || attempt === ACQUISITION_UPLOAD_ATTEMPTS - 1) throw failure;
    onRetry?.(attempt + 1);
    await delay(Math.round(500 * 2 ** attempt * (1 + random() / 2)), signal);
  }
  throw new Error(fallback);
}

// The caller persists the blob first and clears it only after acknowledgement.
export async function uploadAcquisitionPhoto(url: string, blob: Blob, options: UploadOptions) {
  await postWithRetry(url, blob, blob.type, value => value?.ready === true,
    "Upload was not saved; retry", options);
}

// Slot reservation is already idempotent under this exact request key. Do not
// extend these retries to arbitrary control/review/Inventory operations.
export async function reserveAcquisitionPhotoSlot<T>(
  url: string,
  requestKey: string,
  options: Omit<UploadOptions, "signal"> & { signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    return await postWithRetry<T>(url, JSON.stringify({ action: "reserve", requestKey }),
      "application/json", value => Boolean(typeof value?.slot?.id === "string" &&
        value.slot.id.length > 0 && Number.isInteger(value.slot.generation) && value.slot.generation >= 0),
      "Capture slot was not saved; retry", { ...options, signal: options.signal ?? controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
