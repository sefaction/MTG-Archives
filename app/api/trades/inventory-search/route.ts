import { NextResponse } from "next/server";
import { InventoryLocationKind, TradeStatus } from "@prisma/client";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const activeTradeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

function cardImage(card: { imageUri?: string | null; imageUris?: unknown }) {
  const imageUris = card.imageUris as
    { small?: string | null; normal?: string | null } | null | undefined;
  return imageUris?.small ?? imageUris?.normal ?? card.imageUri ?? "";
}

function selectedPriceLabel(prices: unknown) {
  const values = prices && typeof prices === "object" ? (prices as any) : {};
  const mtgjson =
    values.mtgjson && typeof values.mtgjson === "object"
      ? (values.mtgjson as any)
      : {};
  const value =
    mtgjson.price ??
    mtgjson.usd ??
    values.usd ??
    values.usd_foil ??
    values.usd_etched ??
    "";
  return value ? `$${Number(value).toFixed(2)}` : "";
}

export async function GET(request: Request) {
  const actor = await requireLogin();
  const scope = await getAccessScope(actor);
  const isAdmin = scope?.mode === "admin";
  const url = new URL(request.url);
  const ownerId = url.searchParams.get("ownerId") || "";
  const query = (url.searchParams.get("q") || "").trim();

  if (!ownerId) {
    return NextResponse.json({ items: [] });
  }
  if (!isAdmin && !actor.playerId) {
    return NextResponse.json(
      { error: "Missing player account." },
      { status: 403 },
    );
  }
  const owner = await prisma.player.findFirst({
    where: { id: ownerId, active: true },
    select: { id: true },
  });
  if (!owner) {
    return NextResponse.json(
      { error: "Trade owner not found." },
      { status: 404 },
    );
  }
  if (query.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const rows = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: ownerId,
      quantity: { gt: 0 },
      OR: [
        { locationId: null },
        { location: { kind: InventoryLocationKind.NORMAL } },
      ],
      card: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { setCode: { contains: query.toLowerCase() } },
          { setName: { contains: query, mode: "insensitive" } },
          { collectorNumber: { contains: query, mode: "insensitive" } },
        ],
      },
    },
    include: { card: true, location: true },
    orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
    take: 24,
  });

  const itemIds = rows.map((row) => row.id);
  const activeReservations = itemIds.length
    ? await prisma.trade.findMany({
        where: {
          status: { in: activeTradeStatuses },
          OR: [
            { offeredInventoryItemId: { in: itemIds } },
            { requestedInventoryItemId: { in: itemIds } },
          ],
        },
        select: {
          offeredInventoryItemId: true,
          requestedInventoryItemId: true,
        },
      })
    : [];
  const reservedCount = new Map<string, number>();
  for (const trade of activeReservations) {
    for (const id of [
      trade.offeredInventoryItemId,
      trade.requestedInventoryItemId,
    ]) {
      if (id) reservedCount.set(id, (reservedCount.get(id) || 0) + 1);
    }
  }

  return NextResponse.json({
    items: rows.map((item) => ({
      id: item.id,
      cardName: item.card.name,
      setCode: item.card.setCode,
      collectorNumber: item.card.collectorNumber,
      condition: item.condition,
      foilStatus: item.foilStatus,
      quantity: item.quantity,
      available: Math.max(0, item.quantity - (reservedCount.get(item.id) || 0)),
      imageUri: cardImage(item.card),
      typeLine: item.card.typeLine,
      colorIdentity: item.card.colorIdentity,
      priceLabel: selectedPriceLabel(item.card.prices),
      locationName: item.location?.name ?? "Unassigned",
    })),
  });
}
