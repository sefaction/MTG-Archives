import { z } from "zod";
import { acquisitionCatalogCardSchema } from "./acquisition-catalog";
import {
  catalogQuerySchema,
  type CatalogQuery,
} from "./acquisition-catalog-queries";
import { acquisitionCollectorKey } from "./acquisition-recognition";
import {
  getAcquisitionCardResult,
  searchAcquisitionPrintingsPageResult,
  type ScryfallCard,
  type ScryfallClientError,
} from "./scryfall";

export type CatalogLookupResult = {
  status: "FOUND" | "NOT_FOUND" | "PROVIDER_ERROR" | "INCOMPLETE";
  cards: ScryfallCard[];
  requestsMade: number;
  printingCoverage: "CHECKED" | "UNRESOLVED";
  errorKind?: ScryfallClientError["kind"];
  retryAfterMs?: number;
  httpStatus?: number;
};
export const acquisitionCatalogProvider = {
  card: getAcquisitionCardResult,
  printings: searchAcquisitionPrintingsPageResult,
};
type Provider = typeof acquisitionCatalogProvider;

function checkedCard(value: unknown) {
  return acquisitionCatalogCardSchema.parse(value) as ScryfallCard;
}

// Called by a metadata-only service, never by native photo processing. Bounded
// complete pagination is required before asserting checked printing coverage.
export async function fetchAcquisitionCatalogQuery(
  raw: CatalogQuery,
  signal: AbortSignal,
  provider: Provider = acquisitionCatalogProvider,
): Promise<CatalogLookupResult> {
  const query = catalogQuerySchema.parse(raw);
  const cards = new Map<string, ScryfallCard>();
  let requestsMade = 0;
  const failure = (
    error: ScryfallClientError,
    initial: boolean,
  ): CatalogLookupResult => ({
    status:
      error.kind === "NOT_FOUND" && initial ? "NOT_FOUND" : "PROVIDER_ERROR",
    cards: [...cards.values()],
    requestsMade,
    printingCoverage: "UNRESOLVED",
    errorKind: error.kind,
    retryAfterMs: error.retryAfterMs,
    httpStatus: error.status,
  });
  try {
    signal.throwIfAborted();
    const found = await provider.card(query, signal);
    requestsMade += found.requestsMade;
    signal.throwIfAborted();
    if (!found.ok) return failure(found.error, true);
    const first = checkedCard(found.data);
    if (
      (query.kind === "id" && first.id !== query.id) ||
      (query.kind === "printing" &&
        (first.set !== query.set ||
          acquisitionCollectorKey(first.collector_number) !==
            acquisitionCollectorKey(query.number) ||
          first.lang !== query.language))
    )
      throw new Error("Printing response does not match request");
    if (first.digital === true)
      return {
        status: "NOT_FOUND",
        cards: [],
        requestsMade,
        printingCoverage: "UNRESOLVED",
      };
    cards.set(first.id, first);
    const language = first.lang ?? "en";
    // At most 100 pages / 20,000 printings. A bound is incomplete coverage,
    // never evidence that no additional printing or stamped variant exists.
    for (let page = 1; page <= 100; page++) {
      signal.throwIfAborted();
      const response = await provider.printings(
        first.name,
        page,
        language,
        signal,
      );
      requestsMade += response.requestsMade;
      signal.throwIfAborted();
      if (!response.ok) return failure(response.error, false);
      const data = z
        .object({
          object: z.literal("list"),
          has_more: z.boolean(),
          data: z.array(acquisitionCatalogCardSchema).min(1).max(200),
        })
        .parse(response.data);
      const before = cards.size;
      for (const rawCard of data.data) {
        const card = checkedCard(rawCard);
        // The exact-name query must not broaden silently, even if a provider or
        // test endpoint returns structurally valid but unrelated cards.
        if (
          card.name !== first.name ||
          card.lang !== language ||
          card.digital === true
        )
          throw new Error("Unexpected printing search result");
        cards.set(card.id, card);
      }
      if (page > 1 && cards.size === before)
        throw new Error("Repeated printing page");
      if (!data.has_more)
        return {
          status: "FOUND",
          cards: [...cards.values()],
          requestsMade,
          printingCoverage: "CHECKED",
        };
    }
    return {
      status: "INCOMPLETE",
      cards: [...cards.values()],
      requestsMade,
      printingCoverage: "UNRESOLVED",
    };
  } catch {
    return {
      status: "PROVIDER_ERROR",
      cards: [...cards.values()],
      requestsMade,
      printingCoverage: "UNRESOLVED",
      errorKind: signal.aborted ? "TIMEOUT" : "INVALID_RESPONSE",
    };
  }
}
