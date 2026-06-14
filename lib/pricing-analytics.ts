import { prisma } from "./prisma";
import type { AccessScope } from "./auth";
import {
  finishForFoilStatus,
  providerLabel,
  selectPreferredCardPrice,
  type PriceSnapshotLike,
} from "./price-history";

export type PricingScope = "collection" | "location" | "card";
export type PricingRange = "7" | "30" | "90" | "all";

export type PricingAnalyticsOptions = {
  accessScope: AccessScope;
  scope?: PricingScope;
  locationId?: string;
  cardId?: string;
  provider?: string;
  finish?: string;
  priceType?: string;
  currency?: string;
  range?: PricingRange;
};

export function money(value: number, currency = "USD") {
  const prefix = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${prefix}${value.toFixed(2)}`;
}

function numberValue(value: unknown) {
  const numeric = Number(
    typeof value === "object" && value && "toString" in value
      ? value.toString()
      : value,
  );
  return Number.isFinite(numeric) ? numeric : null;
}

export async function getLatestPriceSnapshotsForCards(
  cardIds: string[],
  options: { provider?: string; currency?: string; priceType?: string } = {},
) {
  const uniqueCardIds = Array.from(new Set(cardIds)).filter(Boolean);
  if (!uniqueCardIds.length) return new Map<string, PriceSnapshotLike[]>();
  const rows = await prisma.cardPriceSnapshot.findMany({
    where: {
      cardId: { in: uniqueCardIds },
      ...(options.provider && options.provider !== "scryfall"
        ? { provider: options.provider }
        : {}),
      currency: (options.currency || "USD").toUpperCase(),
      priceType: options.priceType || "retail",
    },
    orderBy: [{ observedDate: "desc" }],
    distinct: ["cardId", "provider", "finish", "priceType", "currency"],
    select: {
      cardId: true,
      provider: true,
      finish: true,
      priceType: true,
      currency: true,
      price: true,
      observedDate: true,
    },
  });
  const byCard = new Map<string, PriceSnapshotLike[]>();
  for (const row of rows) {
    const list = byCard.get(row.cardId) || [];
    list.push(row);
    byCard.set(row.cardId, list);
  }
  return byCard;
}

function ownerWhere(accessScope: AccessScope) {
  return accessScope.mode === "admin" ? {} : { currentOwnerId: accessScope.playerId || "" };
}

function rangeStartDate(range: PricingRange, latestDate = new Date()) {
  if (range === "all") return null;
  const days = Number(range);
  return new Date(latestDate.getTime() - days * 24 * 60 * 60 * 1000);
}

function chooseSnapshotAtOrBefore(
  snapshots: PriceSnapshotLike[],
  date: Date | null,
  options: { provider: string; finish: string; priceType: string; currency: string },
) {
  const filtered = snapshots
    .filter(
      (snapshot) =>
        snapshot.provider === options.provider &&
        snapshot.finish === options.finish &&
        snapshot.priceType === options.priceType &&
        snapshot.currency.toUpperCase() === options.currency,
    )
    .map((snapshot) => ({ ...snapshot, amount: numberValue(snapshot.price), observed: new Date(snapshot.observedDate) }))
    .filter((snapshot) => snapshot.amount !== null)
    .sort((a, b) => b.observed.getTime() - a.observed.getTime());
  if (!filtered.length) return null;
  if (!date) return filtered[filtered.length - 1];
  return filtered.find((snapshot) => snapshot.observed <= date) || filtered[filtered.length - 1];
}

export async function getPricingFilterOptions() {
  const [providers, finishes, priceTypes, currencies] = await Promise.all([
    prisma.cardPriceSnapshot.findMany({ distinct: ["provider"], select: { provider: true }, orderBy: { provider: "asc" } }),
    prisma.cardPriceSnapshot.findMany({ distinct: ["finish"], select: { finish: true }, orderBy: { finish: "asc" } }),
    prisma.cardPriceSnapshot.findMany({ distinct: ["priceType"], select: { priceType: true }, orderBy: { priceType: "asc" } }),
    prisma.cardPriceSnapshot.findMany({ distinct: ["currency"], select: { currency: true }, orderBy: { currency: "asc" } }),
  ]);
  return {
    providers: providers.map((row) => row.provider),
    finishes: finishes.map((row) => row.finish),
    priceTypes: priceTypes.map((row) => row.priceType),
    currencies: currencies.map((row) => row.currency),
  };
}

export async function getPricingAnalytics(options: PricingAnalyticsOptions) {
  const scope = options.scope || "collection";
  const provider = options.provider || "tcgplayer";
  const priceType = options.priceType || "retail";
  const currency = (options.currency || "USD").toUpperCase();
  const range = options.range || "30";
  const where: any = { quantity: { gt: 0 }, ...ownerWhere(options.accessScope) };
  if (scope === "location" && options.locationId) where.locationId = options.locationId;
  if (scope === "card" && options.cardId) where.cardId = options.cardId;

  const items = await prisma.inventoryItem.findMany({
    where,
    select: {
      quantity: true,
      foilStatus: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      cardId: true,
      card: {
        select: {
          id: true,
          name: true,
          setCode: true,
          collectorNumber: true,
          prices: true,
          priceSnapshots: {
            where: {
              ...(provider !== "scryfall" ? { provider } : {}),
              priceType,
              currency,
            },
            orderBy: [{ observedDate: "desc" }],
            take: scope === "card" ? 240 : 120,
          },
        },
      },
    },
  });

  const latestDates = items.flatMap((item) => item.card.priceSnapshots.map((snapshot) => new Date(snapshot.observedDate)));
  const latestDate = latestDates.sort((a, b) => b.getTime() - a.getTime())[0] || new Date();
  const startDate = rangeStartDate(range, latestDate);
  let currentValue = 0;
  let startValue = 0;
  let missingPrices = 0;
  const movers = new Map<string, any>();
  const locationValues = new Map<string, any>();

  for (const item of items) {
    const finish = options.finish && options.finish !== "any" ? options.finish : finishForFoilStatus(item.foilStatus);
    const latest =
      provider === "scryfall"
        ? selectPreferredCardPrice([], item.card.prices, { preferredProvider: "scryfall", finish, currency })
        : selectPreferredCardPrice(item.card.priceSnapshots, item.card.prices, { preferredProvider: provider, finish, currency });
    const baseline = chooseSnapshotAtOrBefore(item.card.priceSnapshots, startDate, { provider, finish, priceType, currency });
    if (!latest?.amount) missingPrices += item.quantity;
    const latestAmount = latest?.amount || 0;
    const startAmount = Number(baseline?.amount ?? latestAmount);
    const currentImpact = latestAmount * item.quantity;
    const startImpact = startAmount * item.quantity;
    currentValue += currentImpact;
    startValue += startImpact;
    const cardKey = `${item.cardId}|${finish}`;
    const existing = movers.get(cardKey) || {
      cardId: item.cardId,
      name: item.card.name,
      setCode: item.card.setCode,
      collectorNumber: item.card.collectorNumber,
      finish,
      quantity: 0,
      currentPrice: latestAmount,
      startPrice: startAmount,
      currentValue: 0,
      startValue: 0,
    };
    existing.quantity += item.quantity;
    existing.currentValue += currentImpact;
    existing.startValue += startImpact;
    existing.priceChange = existing.currentPrice - existing.startPrice;
    existing.valueChange = existing.currentValue - existing.startValue;
    existing.percentChange = existing.startPrice ? (existing.priceChange / existing.startPrice) * 100 : null;
    movers.set(cardKey, existing);

    const locationKey = item.locationId || "unassigned";
    const location = locationValues.get(locationKey) || {
      id: item.locationId,
      name: item.location?.name || "Unassigned",
      quantity: 0,
      uniqueCards: new Set<string>(),
      currentValue: 0,
      startValue: 0,
    };
    location.quantity += item.quantity;
    location.uniqueCards.add(item.cardId);
    location.currentValue += currentImpact;
    location.startValue += startImpact;
    location.valueChange = location.currentValue - location.startValue;
    location.percentChange = location.startValue ? (location.valueChange / location.startValue) * 100 : null;
    locationValues.set(locationKey, location);
  }

  const valueChange = currentValue - startValue;
  const percentChange = startValue ? (valueChange / startValue) * 100 : null;
  const moverRows = Array.from(movers.values()).filter((row) => row.currentPrice || row.startPrice);
  const topGainers = [...moverRows].sort((a, b) => b.valueChange - a.valueChange).slice(0, 10);
  const topLosers = [...moverRows].sort((a, b) => a.valueChange - b.valueChange).slice(0, 10);
  const locationRows = Array.from(locationValues.values()).map((row) => ({ ...row, uniqueCards: row.uniqueCards.size })).sort((a, b) => b.currentValue - a.currentValue);
  const cardHistory = scope === "card" && items[0]
    ? items[0].card.priceSnapshots.slice(0, 120).map((snapshot) => ({
        provider: snapshot.provider,
        providerLabel: providerLabel(snapshot.provider),
        finish: snapshot.finish,
        priceType: snapshot.priceType,
        currency: snapshot.currency,
        price: Number(snapshot.price),
        observedDate: snapshot.observedDate.toISOString().slice(0, 10),
      }))
    : [];

  return {
    scope,
    provider,
    priceType,
    currency,
    range,
    currentValue,
    startValue,
    valueChange,
    percentChange,
    missingPrices,
    totalCards: items.reduce((sum, item) => sum + item.quantity, 0),
    uniqueCards: new Set(items.map((item) => item.cardId)).size,
    topGainers,
    topLosers,
    locationRows,
    cardHistory,
    cardLabel: items[0]?.card ? `${items[0].card.name} (${items[0].card.setCode.toUpperCase()} #${items[0].card.collectorNumber})` : null,
  };
}
