import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { cardWriteData } from "./card-import";
import { acquisitionCatalogCardSchema } from "./acquisition-catalog";
import {
  catalogQueryKey,
  catalogQuerySchema,
  type CatalogQuery,
} from "./acquisition-catalog-queries";
import {
  fetchAcquisitionCatalogQuery,
  type CatalogLookupResult,
} from "./acquisition-catalog-provider";
import type { ScryfallCard } from "./scryfall";

const resultSchema = z.object({
  status: z.enum(["FOUND", "NOT_FOUND", "PROVIDER_ERROR", "INCOMPLETE"]),
  ids: z.array(z.string().uuid()).max(20000),
  requestsMade: z.number().int().nonnegative(),
  printingCoverage: z.enum(["CHECKED", "UNRESOLVED"]),
  errorKind: z
    .enum([
      "NOT_FOUND",
      "INVALID_QUERY",
      "RATE_LIMITED",
      "TIMEOUT",
      "NETWORK",
      "UPSTREAM",
      "INVALID_RESPONSE",
    ])
    .optional(),
  retryAfterMs: z.number().finite().nonnegative().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
});
export type CachedCatalogResult =
  | (CatalogLookupResult & { cacheHit: boolean; lookupKey: string })
  | { status: "PENDING"; cacheHit: false; lookupKey: string };
type Fetcher = typeof fetchAcquisitionCatalogQuery;

// Worker/internal service only. Callers must authorize user requests before
// invoking this primitive. The external fetch sees only the bounded query.
export async function resolveCachedAcquisitionCatalog(
  db: PrismaClient,
  raw: CatalogQuery,
  signal: AbortSignal,
  fetcher: Fetcher = fetchAcquisitionCatalogQuery,
): Promise<CachedCatalogResult> {
  const query = catalogQuerySchema.parse(raw);
  const key = catalogQueryKey(query);
  const now = new Date();
  signal.throwIfAborted();
  await db.acquisitionCatalogLookup.upsert({
    where: { key },
    update: {},
    create: { key, request: query },
  });
  const previous = await db.acquisitionCatalogLookup.findUniqueOrThrow({
    where: { key },
  });
  const saved = resultSchema.safeParse(previous.result);
  if (
    previous.status !== "RUNNING" &&
    previous.expiresAt &&
    previous.expiresAt > now &&
    saved.success
  ) {
    const rows = await db.card.findMany({
      where: { scryfallId: { in: saved.data.ids } },
      select: { scryfallId: true, rawScryfallJson: true },
    });
    // A locally removed cache row is a real gap, even if an older lookup claims
    // success. Reconcile it again instead of treating the missing card as blur.
    const cards = rows.map((row) =>
      acquisitionCatalogCardSchema.safeParse(row.rawScryfallJson),
    );
    if (
      rows.length === saved.data.ids.length &&
      cards.every((card) => card.success)
    ) {
      const { ids: _ids, ...result } = saved.data;
      return {
        ...result,
        cards: cards.map((card) => card.data as ScryfallCard),
        cacheHit: true,
        lookupKey: key,
      };
    }
  }
  // A provider block applies to other uncached queries too. Existing valid
  // cache entries above remain usable while the shared cooldown is active.
  const cooldown = await db.acquisitionCatalogLookup.findFirst({
    where: {
      status: "PROVIDER_ERROR",
      expiresAt: { gt: now },
      OR: [
        { result: { path: ["errorKind"], equals: "RATE_LIMITED" } },
        { result: { path: ["httpStatus"], equals: 401 } },
        { result: { path: ["httpStatus"], equals: 403 } },
      ],
    },
    orderBy: { expiresAt: "desc" },
  });
  if (cooldown?.expiresAt) {
    const reason = resultSchema.parse(cooldown.result);
    return {
      status: "PROVIDER_ERROR",
      cards: [],
      requestsMade: 0,
      printingCoverage: "UNRESOLVED",
      errorKind: reason.errorKind,
      httpStatus: reason.httpStatus,
      retryAfterMs: cooldown.expiresAt.getTime() - now.getTime(),
      cacheHit: true,
      lookupKey: key,
    };
  }
  const token = randomUUID();
  const acquired = await db.acquisitionCatalogLookup.updateMany({
    where: {
      key,
      updatedAt: previous.updatedAt,
      OR: [{ status: { not: "RUNNING" } }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      status: "RUNNING",
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + 180000),
    },
  });
  if (!acquired.count)
    return { status: "PENDING", cacheHit: false, lookupKey: key };
  let fetched: CatalogLookupResult;
  try {
    fetched = await fetcher(query, signal);
  } catch {
    fetched = {
      status: "PROVIDER_ERROR",
      cards: [],
      requestsMade: 0,
      printingCoverage: "UNRESOLVED",
      errorKind: signal.aborted ? "TIMEOUT" : "NETWORK",
    };
  }
  const { cards, ...details } = fetched;
  const stored = resultSchema.parse({
    ...details,
    ids: cards.map((c) => c.id),
  });
  const expiresAt = new Date(
    Date.now() +
      (fetched.status === "FOUND"
        ? 86400000
        : fetched.status === "NOT_FOUND"
          ? 3600000
          : Math.max(
              fetched.httpStatus === 401 || fetched.httpStatus === 403
                ? 3600000
                : 300000,
              fetched.retryAfterMs ?? 0,
            )),
  );
  const published = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "AcquisitionCatalogLookup" WHERE "key" = ${key} FOR UPDATE`;
      const current = await tx.acquisitionCatalogLookup.findUniqueOrThrow({
        where: { key },
      });
      if (
        current.status !== "RUNNING" ||
        current.leaseToken !== token ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= new Date()
      )
        return false;
      for (const card of cards) {
        const validated = acquisitionCatalogCardSchema.parse(
          card,
        ) as ScryfallCard;
        const data = cardWriteData(validated) as Omit<
          Prisma.CardCreateManyInput,
          "scryfallId"
        >;
        const existing = await tx.card.findUnique({
          where: { scryfallId: card.id },
          select: { scryfallFingerprint: true, lastSyncedAt: true },
        });
        // Never replace stable local Card IDs or roll newer metadata backward.
        if (
          existing?.scryfallFingerprint === data.scryfallFingerprint ||
          (existing?.lastSyncedAt && existing.lastSyncedAt > now)
        )
          continue;
        await tx.card.upsert({
          where: { scryfallId: card.id },
          create: { ...data, scryfallId: card.id, firstCachedAt: new Date() },
          update: {
            ...data,
            priceLastFetchedAt: data.priceLastFetchedAt ?? undefined,
          },
        });
      }
      await tx.acquisitionCatalogLookup.update({
        where: { key },
        data: {
          status: fetched.status,
          result: stored,
          expiresAt,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      return true;
    },
    { timeout: 60000 },
  );
  return published
    ? { ...fetched, cacheHit: false, lookupKey: key }
    : { status: "PENDING", cacheHit: false, lookupKey: key };
}
