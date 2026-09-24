import { createNotification } from "@/lib/notifications";
import { finishForFoilStatus } from "@/lib/price-history";
import { queryPricingJson } from "@/lib/pricing-db-query";
import { prisma } from "@/lib/prisma";

export const PRICING_DIGEST_CATEGORY = "pricing_movers";
const MAX_DIGEST_CARDS = 100;

type Movement = {
  mtgjsonUuid: string;
  startPrice: number;
  currentPrice: number;
  absoluteChange: number;
  percentChange: number | null;
  startObservedDate: string;
  currentObservedDate: string;
  ownedQuantity: number;
  collectionImpact: number;
  totalMovers: number;
  isCorrection: boolean;
};

type AlertedMovement = Pick<Movement, "mtgjsonUuid" | "currentObservedDate" | "currentPrice">;

type Retraction = Movement & { previouslyAlertedPrice: number };

function isMeaningfulMovement(
  row: Pick<Movement, "startPrice" | "absoluteChange" | "percentChange">,
  preference: { thresholdMode: string; minAbsolute: unknown; minPercent: unknown; minPriorPrice: unknown },
) {
  const absolute = Math.abs(row.absoluteChange) >= Number(preference.minAbsolute);
  const percent = row.startPrice >= Number(preference.minPriorPrice) &&
    row.percentChange != null && Math.abs(row.percentChange) >= Number(preference.minPercent);
  return preference.thresholdMode === "percent" ? percent :
    preference.thresholdMode === "either" ? absolute || percent : absolute;
}

export function pricingRetractionSql(input: {
  alerted: AlertedMovement[];
  importedDate: string;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.importedDate))
    throw new Error("Invalid digest import date.");
  const values = input.alerted
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.currentObservedDate))
    .map((row) => `(${sqlString(row.mtgjsonUuid)}, ${sqlString(row.currentObservedDate)}::date, ${number(row.currentPrice)}::numeric)`)
    .join(", ");
  if (!values) return null;
  const dayStart = `${input.importedDate}T00:00:00.000Z`;
  const nextDayStart = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
  return `WITH alerted(mtgjson_uuid, observed_date, alerted_price) AS (VALUES ${values})
  SELECT d.mtgjson_uuid AS "mtgjsonUuid", prior.price::float8 AS "startPrice",
    d.price::float8 AS "currentPrice", (d.price-prior.price)::float8 AS "absoluteChange",
    CASE WHEN prior.price=0 THEN NULL ELSE ROUND((d.price-prior.price)/prior.price*100,2)::float8 END AS "percentChange",
    prior.observed_date::text AS "startObservedDate", d.observed_date::text AS "currentObservedDate",
    a.alerted_price::float8 AS "previouslyAlertedPrice"
  FROM alerted a JOIN price_daily_summary d ON d.mtgjson_uuid=a.mtgjson_uuid AND d.observed_date=a.observed_date
  JOIN LATERAL (SELECT p.observed_date,p.price FROM price_daily_summary p
    WHERE (p.mtgjson_uuid,p.provider,p.finish,p.price_type,p.currency)=
      (d.mtgjson_uuid,d.provider,d.finish,d.price_type,d.currency)
      AND p.observed_date<d.observed_date ORDER BY p.observed_date DESC LIMIT 1) prior ON TRUE
  WHERE d.provider=${sqlString(input.provider)} AND d.finish=${sqlString(input.finish)}
    AND d.price_type=${sqlString(input.priceType)} AND d.currency=${sqlString(input.currency)}
    AND d.created_at >= ${sqlString(dayStart)}::timestamptz
    AND d.created_at < ${sqlString(nextDayStart)}::timestamptz
    AND d.source_revision_count > 0 AND d.price <> a.alerted_price`;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function number(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

export function priorUtcDay(now: Date) {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function dailyPricingMovementSql(input: {
  owned: Array<{ mtgjsonUuid: string; quantity: number }>;
  observedDate: string;
  enabledAt: Date;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  thresholdMode: string;
  minAbsolute: number;
  minPercent: number;
  minPriorPrice: number;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedDate))
    throw new Error("Invalid digest observation date.");
  const dayStart = `${input.observedDate}T00:00:00.000Z`;
  const nextDayStart = new Date(
    Date.parse(dayStart) + 86_400_000,
  ).toISOString();
  const values = input.owned
    .filter((card) => card.mtgjsonUuid && card.quantity > 0)
    .map(
      (card) =>
        `(${sqlString(card.mtgjsonUuid)}, ${number(Math.trunc(card.quantity))}::int)`,
    )
    .join(", ");
  if (!values) return null;
  const absolute = `ABS("absoluteChange") >= ${number(input.minAbsolute)}`;
  const percent = `("startPrice" >= ${number(input.minPriorPrice)} AND ABS("percentChange") >= ${number(input.minPercent)})`;
  const criterion =
    input.thresholdMode === "percent"
      ? percent
      : input.thresholdMode === "either"
        ? `(${absolute} OR ${percent})`
        : absolute;
  return `WITH holdings(mtgjson_uuid, owned_quantity) AS (
    VALUES ${values}
  ), movements AS (
    SELECT d.mtgjson_uuid AS "mtgjsonUuid",
      prior.price::float8 AS "startPrice",
      d.price::float8 AS "currentPrice",
      (d.price - prior.price)::float8 AS "absoluteChange",
      CASE WHEN prior.price = 0 THEN NULL ELSE
        ROUND((d.price - prior.price) / prior.price * 100, 2)::float8
      END AS "percentChange",
      prior.observed_date::text AS "startObservedDate",
      d.observed_date::text AS "currentObservedDate",
      h.owned_quantity AS "ownedQuantity",
      ROUND((d.price - prior.price) * h.owned_quantity, 2)::float8 AS "collectionImpact",
      (d.source_revision_count > 0) AS "isCorrection"
    FROM price_daily_summary d JOIN holdings h ON h.mtgjson_uuid = d.mtgjson_uuid
    JOIN LATERAL (
      SELECT p.observed_date, p.price FROM price_daily_summary p
      WHERE (p.mtgjson_uuid,p.provider,p.finish,p.price_type,p.currency) =
            (d.mtgjson_uuid,d.provider,d.finish,d.price_type,d.currency)
        AND p.observed_date < d.observed_date
      ORDER BY p.observed_date DESC LIMIT 1
    ) prior ON TRUE
    WHERE d.provider = ${sqlString(input.provider)}
      AND d.finish = ${sqlString(input.finish)}
      AND d.price_type = ${sqlString(input.priceType)}
      AND d.currency = ${sqlString(input.currency)}
      AND d.created_at >= ${sqlString(dayStart)}::timestamptz
      AND d.created_at < ${sqlString(nextDayStart)}::timestamptz
      AND d.created_at >= ${sqlString(input.enabledAt.toISOString())}::timestamptz
      AND d.observed_date BETWEEN (${sqlString(input.observedDate)}::date - INTERVAL '90 days') AND ${sqlString(input.observedDate)}::date
      AND d.price <> prior.price
  ), eligible AS (SELECT * FROM movements WHERE ${criterion})
  SELECT *, COUNT(*) OVER()::int AS "totalMovers"
  FROM eligible ORDER BY ABS("collectionImpact") DESC, ABS("absoluteChange") DESC
  LIMIT ${MAX_DIGEST_CARDS}`;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export async function processDailyPricingDigests(now = new Date()) {
  // Wait until 02:00 UTC so a daily import has time to finish. Replay is safe.
  if (now.getUTCHours() < 2) return { checked: 0, created: 0 };
  const observedDate = priorUtcDay(now);
  const dayEnd = new Date(`${observedDate}T23:59:59.999Z`);
  const preferences = await prisma.pricingAlertPreference.findMany({
    where: {
      enabled: true,
      enabledAt: { lte: dayEnd },
      user: { isActive: true, playerId: { not: null } },
    },
    include: { user: { select: { playerId: true } } },
  });
  if (!preferences.length) return { checked: 0, created: 0 };
  const [state] = await queryPricingJson<{
    ready: boolean;
    fresh: boolean;
  }>(
    `SELECT ready,
       (source_max_id IS NOT DISTINCT FROM (SELECT MAX(id) FROM price_snapshots)
        AND source_revision = summary_revision) AS fresh
       FROM price_summary_state WHERE singleton = TRUE`,
    { timeoutMs: 10_000 },
  );
  if (!state?.ready || !state.fresh) return { checked: 0, created: 0 };
  let checked = 0;
  let created = 0;
  for (const preference of preferences) {
    try {
      const existing = await prisma.notification.findUnique({
        where: {
          recipientUserId_sourceType_sourceId: {
            recipientUserId: preference.userId,
            sourceType: "pricing_digest",
            sourceId: observedDate,
          },
        },
        select: { id: true },
      });
      if (existing || !preference.user.playerId || !preference.enabledAt)
        continue;
      if (
        preference.lastCheckedAt &&
        now.getTime() - preference.lastCheckedAt.getTime() < 30 * 60_000
      )
        continue;
      checked += 1;
      const stacks = await prisma.inventoryItem.groupBy({
        by: ["cardId", "foilStatus"],
        where: {
          currentOwnerId: preference.user.playerId,
          quantity: { gt: 0 },
        },
        _sum: { quantity: true },
      });
      const matching = stacks.filter(
        (stack) => finishForFoilStatus(stack.foilStatus) === preference.finish,
      );
      if (!matching.length) {
        await prisma.pricingAlertPreference.update({
          where: { userId: preference.userId },
          data: { lastCheckedAt: now, lastError: null },
        });
        continue;
      }
      const cards = await prisma.card.findMany({
        where: {
          id: { in: matching.map((stack) => stack.cardId) },
          mtgjsonUuid: { not: null },
        },
        select: {
          id: true,
          mtgjsonUuid: true,
          name: true,
          setCode: true,
          collectorNumber: true,
        },
      });
      const byCardId = new Map(cards.map((card) => [card.id, card]));
      const quantities = new Map<string, number>();
      for (const stack of matching) {
        const uuid = byCardId.get(stack.cardId)?.mtgjsonUuid;
        if (uuid)
          quantities.set(
            uuid,
            (quantities.get(uuid) ?? 0) + (stack._sum.quantity ?? 0),
          );
      }
      const query = dailyPricingMovementSql({
        owned: [...quantities].map(([mtgjsonUuid, quantity]) => ({
          mtgjsonUuid,
          quantity,
        })),
        observedDate,
        enabledAt: preference.enabledAt,
        provider: preference.provider,
        finish: preference.finish,
        priceType: preference.priceType,
        currency: preference.currency,
        thresholdMode: preference.thresholdMode,
        minAbsolute: Number(preference.minAbsolute),
        minPercent: Number(preference.minPercent),
        minPriorPrice: Number(preference.minPriorPrice),
      });
      if (!query) continue;
      const movers = await queryPricingJson<Movement>(query, {
        timeoutMs: 10_000,
      });
      // Only retract movements that this owner actually saw. A prior digest's
      // total may exceed its stored detail cap, so unshown movements do not qualify.
      const previous = await prisma.notification.findMany({
        where: {
          recipientUserId: preference.userId,
          sourceType: "pricing_digest",
          sourceId: { lt: observedDate },
          createdAt: { gte: new Date(dayEnd.getTime() - 100 * 86_400_000) },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { metadataJson: true },
      });
      const alerted = new Map<string, AlertedMovement>();
      const retracted = new Set<string>();
      for (const notification of previous) {
        const metadata = notification.metadataJson;
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
        if (metadata.provider !== preference.provider || metadata.finish !== preference.finish ||
            metadata.priceType !== preference.priceType || metadata.currency !== preference.currency) continue;
        if (Array.isArray(metadata.retractedMovers)) {
          for (const item of metadata.retractedMovers) {
            if (item && typeof item === "object" && !Array.isArray(item) &&
                typeof item.mtgjsonUuid === "string" && typeof item.currentDate === "string")
              retracted.add(`${item.mtgjsonUuid}:${item.currentDate}`);
          }
        }
        if (!Array.isArray(metadata.shownMovers)) continue;
        for (const item of metadata.shownMovers) {
          if (!item || typeof item !== "object" || Array.isArray(item) ||
              typeof item.mtgjsonUuid !== "string" || typeof item.currentDate !== "string" ||
              typeof item.currentPrice !== "number" || !/^\d{4}-\d{2}-\d{2}$/.test(item.currentDate)) continue;
          const key = `${item.mtgjsonUuid}:${item.currentDate}`;
          if (!alerted.has(key)) alerted.set(key, {
            mtgjsonUuid: item.mtgjsonUuid,
            currentObservedDate: item.currentDate,
            currentPrice: item.currentPrice,
          });
        }
      }
      const ownedAlerted = [...alerted].filter(([key, item]) =>
        !retracted.has(key) && quantities.has(item.mtgjsonUuid));
      const retractionQuery = pricingRetractionSql({
        alerted: ownedAlerted.map(([, item]) => item),
        importedDate: observedDate,
        provider: preference.provider,
        finish: preference.finish,
        priceType: preference.priceType,
        currency: preference.currency,
      });
      const corrected = retractionQuery
        ? await queryPricingJson<Movement & { previouslyAlertedPrice: number }>(retractionQuery, { timeoutMs: 10_000 })
        : [];
      const retractions: Retraction[] = corrected
        .filter((row) => !isMeaningfulMovement(row, preference))
        .map((row) => ({
          ...row,
          ownedQuantity: quantities.get(row.mtgjsonUuid) ?? 0,
          collectionImpact: row.absoluteChange * (quantities.get(row.mtgjsonUuid) ?? 0),
          totalMovers: 0,
          isCorrection: true,
        }));
      if (!movers.length && !retractions.length) {
        if (preference.lastError)
          await prisma.pricingAlertPreference.update({
            where: { userId: preference.userId },
            data: { lastCheckedAt: now, lastError: null },
          });
        else
          await prisma.pricingAlertPreference.update({
            where: { userId: preference.userId },
            data: { lastCheckedAt: now },
          });
        continue;
      }
      const byUuid = new Map(
        cards
          .filter((card) => card.mtgjsonUuid)
          .map((card) => [card.mtgjsonUuid, card]),
      );
      const top = movers.slice(0, 3).map((row) => {
        const card = byUuid.get(row.mtgjsonUuid);
        return `${card?.name ?? "Unknown printing"} ${row.absoluteChange > 0 ? "+" : ""}${money(row.absoluteChange, preference.currency)}`;
      });
      const count = movers[0]?.totalMovers ?? 0;
      const href = `/pricing/digest/${observedDate}`;
      await createNotification(
        {
          recipientUserId: preference.userId,
          type: "pricing.digest",
          category: PRICING_DIGEST_CATEGORY,
          title: `${count} owned price ${count === 1 ? "mover" : "movers"}${retractions.length ? `, ${retractions.length} corrected below threshold` : ""} imported ${observedDate}`,
          message: `${top.join("; ")}${count > top.length ? `; and ${count - top.length} more` : ""}${retractions.length ? `${top.length ? "; " : ""}${retractions.length} previously alerted ${retractions.length === 1 ? "movement was" : "movements were"} corrected below threshold` : ""}. Observed dates appear in the digest. Captured ${now.toISOString().slice(0, 16)} UTC.`,
          href,
          sourceType: "pricing_digest",
          sourceId: observedDate,
          metadata: {
            observedDate,
            importedDate: observedDate,
            provider: preference.provider,
            finish: preference.finish,
            priceType: preference.priceType,
            currency: preference.currency,
            totalMovers: count,
            generatedAt: now.toISOString(),
            shownMovers: movers.map((row) => ({
              mtgjsonUuid: row.mtgjsonUuid,
              cardId: byUuid.get(row.mtgjsonUuid)?.id ?? null,
              cardName: byUuid.get(row.mtgjsonUuid)?.name ?? null,
              setCode: byUuid.get(row.mtgjsonUuid)?.setCode ?? null,
              collectorNumber:
                byUuid.get(row.mtgjsonUuid)?.collectorNumber ?? null,
              startPrice: row.startPrice,
              currentPrice: row.currentPrice,
              absoluteChange: row.absoluteChange,
              percentChange: row.percentChange,
              priorDate: row.startObservedDate,
              currentDate: row.currentObservedDate,
              ownedQuantity: row.ownedQuantity,
              collectionImpact: row.collectionImpact,
              isCorrection: row.isCorrection,
            })),
            retractedMovers: retractions.slice(0, MAX_DIGEST_CARDS).map((row) => ({
              mtgjsonUuid: row.mtgjsonUuid,
              cardId: byUuid.get(row.mtgjsonUuid)?.id ?? null,
              cardName: byUuid.get(row.mtgjsonUuid)?.name ?? null,
              setCode: byUuid.get(row.mtgjsonUuid)?.setCode ?? null,
              collectorNumber: byUuid.get(row.mtgjsonUuid)?.collectorNumber ?? null,
              startPrice: row.startPrice,
              currentPrice: row.currentPrice,
              previouslyAlertedPrice: row.previouslyAlertedPrice,
              absoluteChange: row.absoluteChange,
              percentChange: row.percentChange,
              priorDate: row.startObservedDate,
              currentDate: row.currentObservedDate,
              ownedQuantity: row.ownedQuantity,
              collectionImpact: row.collectionImpact,
            })),
          },
        },
        {
          notification: prisma.notification,
          notificationDeliveryJob: prisma.notificationDeliveryJob,
        },
      );
      await prisma.pricingAlertPreference.update({
        where: { userId: preference.userId },
        data: { lastSentAt: now, lastCheckedAt: now, lastError: null },
      });
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.pricingAlertPreference.update({
        where: { userId: preference.userId },
        data: { lastError: message.slice(0, 300) },
      });
    }
  }
  return { checked, created };
}
