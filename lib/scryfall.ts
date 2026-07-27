export type ScryfallErrorKind =
  | "NOT_FOUND"
  | "INVALID_QUERY"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "UPSTREAM"
  | "INVALID_RESPONSE";

export type ScryfallClientError = {
  kind: ScryfallErrorKind;
  message: string;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
  details?: unknown;
};

export type ScryfallResult<T> =
  | { ok: true; data: T; correlationId: string; requestsMade: number }
  | {
      ok: false;
      error: ScryfallClientError;
      correlationId: string;
      requestsMade: number;
    };

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  multiverse_ids?: number[];
  mtgo_id?: number;
  arena_id?: number;
  name: string;
  printed_name?: string;
  lang?: string;
  released_at?: string;
  layout?: string;
  highres_image?: boolean;
  image_status?: string;
  mana_cost?: string;
  cmc: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_identity: string[];
  color_indicator?: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
  games?: string[];
  reserved?: boolean;
  foil?: boolean;
  nonfoil?: boolean;
  finishes?: string[];
  oversized?: boolean;
  promo?: boolean;
  reprint?: boolean;
  variation?: boolean;
  digital?: boolean;
  full_art?: boolean;
  textless?: boolean;
  booster?: boolean;
  story_spotlight?: boolean;
  type_line?: string;
  printed_type_line?: string;
  oracle_text?: string;
  printed_text?: string;
  set: string;
  set_id?: string;
  set_name: string;
  set_type?: string;
  collector_number: string;
  rarity: string;
  artist?: string;
  artist_ids?: string[];
  illustration_id?: string;
  border_color?: string;
  frame?: string;
  frame_effects?: string[];
  security_stamp?: string;
  preview?: unknown;
  image_uris?: Record<string, string>;
  card_faces?: Array<
    Record<string, unknown> & {
      name?: string;
      mana_cost?: string;
      type_line?: string;
      oracle_text?: string;
      image_uris?: Record<string, string>;
    }
  >;
  prices?: Record<string, string | null>;
  all_parts?: Array<{
    id?: string;
    object?: string;
    component?: string;
    name?: string;
    type_line?: string;
    uri?: string;
    scryfall_uri?: string;
  }>;
  related_uris?: Record<string, string>;
  purchase_uris?: Record<string, string>;
  scryfall_uri?: string;
  uri?: string;
  object?: string;
};

export type ScryfallCollectionIdentifier =
  | { id: string }
  | { set: string; collector_number: string }
  | { name: string }
  | { name: string; set: string };

export type ScryfallCollectionResponse = {
  object: "list";
  data: ScryfallCard[];
  not_found?: ScryfallCollectionIdentifier[];
};

const DEFAULT_BASE_URL = "https://api.scryfall.com";
const DEFAULT_USER_AGENT = "MTG-Archives/1.0";
const DEFAULT_ACCEPT = "application/json;q=0.9,*/*;q=0.8";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const COLLECTION_BATCH_SIZE = 75;

type ClientConfig = {
  baseUrl: string;
  userAgent: string;
  minRequestIntervalMs: number;
  maxRetries: number;
  timeoutMs: number;
};

let throttleTail: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;
let lastSuccessfulRequestAt: Date | null = null;
let lastFailedRequestAt: Date | null = null;
let recentErrorKind: ScryfallErrorKind | null = null;
let requestCount = 0;

function numericEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getScryfallConfig(): ClientConfig {
  const baseUrl = process.env.SCRYFALL_API_BASE_URL || DEFAULT_BASE_URL;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    userAgent: process.env.SCRYFALL_USER_AGENT || DEFAULT_USER_AGENT,
    minRequestIntervalMs: numericEnv("SCRYFALL_MIN_REQUEST_INTERVAL_MS", 125),
    maxRetries: numericEnv("SCRYFALL_MAX_RETRIES", 4),
    timeoutMs: numericEnv("SCRYFALL_REQUEST_TIMEOUT_MS", 15_000),
  };
}

export function getScryfallRuntimeStatus() {
  const config = getScryfallConfig();
  return {
    apiBaseUrl: config.baseUrl,
    userAgent: config.userAgent,
    minRequestIntervalMs: config.minRequestIntervalMs,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    lastSuccessfulRequestAt,
    lastFailedRequestAt,
    recentErrorKind,
    requestCount,
    cacheEnabled: process.env.SCRYFALL_CACHE_ENABLED !== "false",
    cardRefreshDays: numericEnv("SCRYFALL_CARD_REFRESH_DAYS", 30),
    priceRefreshHours: numericEnv("SCRYFALL_PRICE_REFRESH_HOURS", 24),
    bulkDataEnabled: process.env.SCRYFALL_BULK_DATA_ENABLED !== "false",
    bulkDataPath:
      process.env.SCRYFALL_CONTAINER_DATA_PATH ||
      process.env.SCRYFALL_BULK_DATA_PATH ||
      "/app/data/scryfall",
    bulkRefreshHours: numericEnv("SCRYFALL_BULK_REFRESH_HOURS", 24),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(config: ClientConfig) {
  const previous = throttleTail;
  let release!: () => void;
  throttleTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const elapsed = Date.now() - lastRequestStartedAt;
  if (elapsed < config.minRequestIntervalMs) {
    await sleep(config.minRequestIntervalMs - elapsed);
  }
  lastRequestStartedAt = Date.now();
  release();
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function jitteredBackoff(attempt: number, retryAfter?: number) {
  if (retryAfter !== undefined) return retryAfter;
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base + Math.random() * 250);
}

function makeCorrelationId() {
  return `sf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function parseScryfallError(res: Response): Promise<ScryfallClientError> {
  let details: unknown;
  let message = `Scryfall request failed with HTTP ${res.status}.`;
  try {
    details = await res.json();
    if (
      details &&
      typeof details === "object" &&
      "details" in details &&
      typeof details.details === "string"
    ) {
      message = details.details;
    }
  } catch {
    try {
      const text = await res.text();
      if (text) message = text.slice(0, 300);
    } catch {}
  }

  const retryAfter = retryAfterMs(res.headers.get("Retry-After"));
  if (res.status === 404) {
    return {
      kind: "NOT_FOUND",
      message,
      status: res.status,
      retryable: false,
      details,
    };
  }
  if (res.status === 400) {
    return {
      kind: "INVALID_QUERY",
      message,
      status: res.status,
      retryable: false,
      details,
    };
  }
  if (res.status === 429) {
    return {
      kind: "RATE_LIMITED",
      message: retryAfter
        ? `Scryfall is rate limiting requests. Retry after ${Math.ceil(retryAfter / 1000)} seconds.`
        : "Scryfall is rate limiting requests.",
      status: res.status,
      retryable: true,
      retryAfterMs: retryAfter,
      details,
    };
  }
  return {
    kind: "UPSTREAM",
    message,
    status: res.status,
    retryable: RETRYABLE_STATUSES.has(res.status),
    retryAfterMs: retryAfter,
    details,
  };
}

function logScryfallEvent(event: Record<string, unknown>) {
  const level = event.finalResult === "success" ? "debug" : "warn";
  const logger = level === "debug" ? console.debug : console.warn;
  logger("[scryfall]", JSON.stringify(event));
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  endpointCategory = "unknown",
): Promise<ScryfallResult<T>> {
  const config = getScryfallConfig();
  const correlationId = makeCorrelationId();
  const url = new URL(path, `${config.baseUrl}/`);
  let attempts = 0;
  let requestsMade = 0;

  for (;;) {
    attempts += 1;
    const started = Date.now();
    await throttle(config);
    requestsMade += 1;
    requestCount += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: DEFAULT_ACCEPT,
          "User-Agent": config.userAgent,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      clearTimeout(timeout);
      if (res.ok) {
        try {
          const data = (await res.json()) as T;
          lastSuccessfulRequestAt = new Date();
          logScryfallEvent({
            correlationId,
            endpointCategory,
            status: res.status,
            attempt: attempts,
            durationMs: Date.now() - started,
            finalResult: "success",
          });
          return { ok: true, data, correlationId, requestsMade };
        } catch (error) {
          const normalized: ScryfallClientError = {
            kind: "INVALID_RESPONSE",
            message:
              "Scryfall returned a response that could not be parsed as JSON.",
            status: res.status,
            retryable: false,
            details: error instanceof Error ? error.message : String(error),
          };
          lastFailedRequestAt = new Date();
          recentErrorKind = normalized.kind;
          return { ok: false, error: normalized, correlationId, requestsMade };
        }
      }

      const normalized = await parseScryfallError(res);
      if (!normalized.retryable || attempts > config.maxRetries) {
        lastFailedRequestAt = new Date();
        recentErrorKind = normalized.kind;
        logScryfallEvent({
          correlationId,
          endpointCategory,
          status: res.status,
          attempt: attempts,
          durationMs: Date.now() - started,
          finalResult: normalized.kind,
        });
        return { ok: false, error: normalized, correlationId, requestsMade };
      }
      const delayMs = jitteredBackoff(attempts, normalized.retryAfterMs);
      logScryfallEvent({
        correlationId,
        endpointCategory,
        status: res.status,
        attempt: attempts,
        retryDelayMs: delayMs,
        finalResult: "retrying",
      });
      await sleep(delayMs);
    } catch (error) {
      clearTimeout(timeout);
      const isAbort = error instanceof Error && error.name === "AbortError";
      const normalized: ScryfallClientError = {
        kind: isAbort ? "TIMEOUT" : "NETWORK",
        message: isAbort
          ? "Scryfall request timed out."
          : "Network error while contacting Scryfall.",
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      };
      if (attempts > config.maxRetries) {
        lastFailedRequestAt = new Date();
        recentErrorKind = normalized.kind;
        logScryfallEvent({
          correlationId,
          endpointCategory,
          attempt: attempts,
          durationMs: Date.now() - started,
          finalResult: normalized.kind,
        });
        return { ok: false, error: normalized, correlationId, requestsMade };
      }
      const delayMs = jitteredBackoff(attempts);
      logScryfallEvent({
        correlationId,
        endpointCategory,
        attempt: attempts,
        retryDelayMs: delayMs,
        finalResult: "retrying",
      });
      await sleep(delayMs);
    }
  }
}

export function formatScryfallError(error: ScryfallClientError) {
  return error.message || `Scryfall lookup failed (${error.kind}).`;
}

export async function getCardByScryfallIdResult(id: string) {
  return requestJson<ScryfallCard>(
    `cards/${encodeURIComponent(id)}`,
    {},
    "card_by_id",
  );
}

export async function getCardBySetAndCollectorResult(
  setCode: string,
  collectorNumber: string,
) {
  if (!setCode || !collectorNumber) {
    return {
      ok: false as const,
      correlationId: makeCorrelationId(),
      requestsMade: 0,
      error: {
        kind: "INVALID_QUERY" as const,
        message: "Set code and collector number are required.",
        retryable: false,
      },
    };
  }
  return requestJson<ScryfallCard>(
    `cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber.trim())}`,
    {},
    "card_by_set_collector",
  );
}

export async function getExactCardByNameResult(name: string) {
  if (!name || name.trim().length < 2) {
    return {
      ok: false as const,
      correlationId: makeCorrelationId(),
      requestsMade: 0,
      error: {
        kind: "INVALID_QUERY" as const,
        message: "Card name must be at least 2 characters.",
        retryable: false,
      },
    };
  }
  const params = new URLSearchParams({ exact: name.trim() });
  return requestJson<ScryfallCard>(
    `cards/named?${params}`,
    {},
    "card_by_exact_name",
  );
}

export async function getFuzzyCardResult(name: string) {
  if (!name || name.trim().length < 2) {
    return {
      ok: false as const,
      correlationId: makeCorrelationId(),
      requestsMade: 0,
      error: {
        kind: "INVALID_QUERY" as const,
        message: "Card name must be at least 2 characters.",
        retryable: false,
      },
    };
  }
  const params = new URLSearchParams({ fuzzy: name.trim() });
  return requestJson<ScryfallCard>(
    `cards/named?${params}`,
    {},
    "card_by_fuzzy_name",
  );
}

export async function searchCardsResult(q: string) {
  if (!q || q.trim().length < 2) {
    return {
      ok: true as const,
      data: { object: "list" as const, data: [] as ScryfallCard[] },
      correlationId: makeCorrelationId(),
      requestsMade: 0,
    };
  }
  const params = new URLSearchParams({
    q: q.trim(),
    order: "name",
    unique: "prints",
  });
  return requestJson<{ object: "list"; data: ScryfallCard[] }>(
    `cards/search?${params}`,
    {},
    "card_search",
  );
}

export function buildCardNameSearchQuery(name: string) {
  const escaped = name.trim().replace(/"/g, '\\"');
  return escaped ? `name:"${escaped}"` : "";
}

export function hasScryfallSearchSyntax(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return false;
  return (
    /(^|\s)-?[a-z][a-z0-9_-]*(?::|<=|>=|=|<|>)\s*(?:"[^"]*"|\S+)/i.test(
      trimmed,
    ) ||
    /(^|\s)(?:and|or|not)(?=\s|$)/i.test(trimmed) ||
    /(^|\s)!(?=")/.test(trimmed)
  );
}

export function buildCardPrintingSearchQuery(query: string) {
  const trimmed = query.trim();
  return hasScryfallSearchSyntax(trimmed)
    ? trimmed
    : buildCardNameSearchQuery(trimmed);
}

export async function searchCardPrintsResult(query: string) {
  return searchCardsResult(buildCardPrintingSearchQuery(query));
}

export async function searchCardPrintsByNameResult(name: string) {
  return searchCardsResult(buildCardNameSearchQuery(name));
}

export async function submitCardCollectionResult(
  identifiers: ScryfallCollectionIdentifier[],
) {
  const unique = identifiers.slice(0, COLLECTION_BATCH_SIZE);
  return requestJson<ScryfallCollectionResponse>(
    "cards/collection",
    {
      method: "POST",
      body: JSON.stringify({ identifiers: unique }),
    },
    "card_collection",
  );
}

export async function getBulkDataMetadataResult(type?: string) {
  return requestJson<unknown>(
    type ? `bulk-data/${encodeURIComponent(type)}` : "bulk-data",
    {},
    "bulk_data",
  );
}

export async function getCardByScryfallId(
  id: string,
): Promise<ScryfallCard | null> {
  const result = await getCardByScryfallIdResult(id);
  return result.ok ? result.data : null;
}

export async function getCardBySetAndCollector(
  setCode: string,
  collectorNumber: string,
): Promise<ScryfallCard | null> {
  const result = await getCardBySetAndCollectorResult(setCode, collectorNumber);
  return result.ok ? result.data : null;
}

export async function getFuzzyCard(name: string): Promise<ScryfallCard | null> {
  const result = await getFuzzyCardResult(name);
  return result.ok ? result.data : null;
}

export async function searchCards(q: string): Promise<ScryfallCard[]> {
  const result = await searchCardsResult(q);
  return result.ok ? result.data.data : [];
}

export function __resetScryfallClientForTests() {
  throttleTail = Promise.resolve();
  lastRequestStartedAt = 0;
  lastSuccessfulRequestAt = null;
  lastFailedRequestAt = null;
  recentErrorKind = null;
  requestCount = 0;
}
