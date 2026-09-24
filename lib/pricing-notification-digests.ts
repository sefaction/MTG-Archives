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
      AND d.created_at >= ${sqlString(input.observedDate)}::date
      AND d.created_at < (${sqlString(input.observedDate)}::date + INTERVAL '1 day')
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
       source_max_id IS NOT DISTINCT FROM (SELECT MAX(id) FROM price_snapshots) AS fresh
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
      if (!movers.length) {
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
      const count = movers[0].totalMovers;
      const href = `/pricing/digest/${observedDate}`;
      await createNotification(
        {
          recipientUserId: preference.userId,
          type: "pricing.digest",
          category: PRICING_DIGEST_CATEGORY,
          title: `${count} owned price ${count === 1 ? "mover" : "movers"} imported ${observedDate}`,
          message: `${top.join("; ")}${count > top.length ? `; and ${count - top.length} more` : ""}. Includes late corrections; observed dates appear in the digest. Captured ${now.toISOString().slice(0, 16)} UTC.`,
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
