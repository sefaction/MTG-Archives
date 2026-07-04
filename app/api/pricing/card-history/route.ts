import { NextResponse } from "next/server";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  calculatePriceHistoryChange,
  getCardPriceHistory,
  normalizePriceHistoryRange,
} from "@/lib/pricing-worker-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringParam(request: Request, name: string) {
  return new URL(request.url).searchParams.get(name)?.trim() || "";
}

function cleanToken(value: string, fallback: string) {
  return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : fallback;
}

function cleanCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value) ? value : "USD";
}

function emptyHistoryResponse({
  card,
  provider,
  finish,
  priceType,
  currency,
  range,
}: {
  card: { id: string; name: string; mtgjsonUuid: string | null };
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  range: ReturnType<typeof normalizePriceHistoryRange>;
}) {
  return NextResponse.json({
    available: true,
    card,
    provider,
    finish,
    priceType,
    currency,
    range,
    points: [],
    change: calculatePriceHistoryChange([]),
  });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cardId = stringParam(request, "cardId");
  if (!cardId)
    return NextResponse.json({ error: "cardId is required." }, { status: 400 });

  const scope = await getAccessScope(user);
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, name: true, mtgjsonUuid: true },
  });
  if (!card) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (scope?.mode !== "admin") {
    const ownedCount = user.playerId
      ? await prisma.inventoryItem.count({
          where: { cardId, currentOwnerId: user.playerId, quantity: { gt: 0 } },
        })
      : 0;
    if (!ownedCount)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const provider = cleanToken(stringParam(request, "provider"), "tcgplayer");
  const finish = cleanToken(stringParam(request, "finish"), "normal");
  const priceType = cleanToken(stringParam(request, "priceType"), "retail");
  const currency = cleanCurrency(
    (stringParam(request, "currency") || "USD").toUpperCase(),
  );
  const range = normalizePriceHistoryRange(stringParam(request, "range"));

  if (!card.mtgjsonUuid) {
    return emptyHistoryResponse({
      card,
      provider,
      finish,
      priceType,
      currency,
      range,
    });
  }

  try {
    const history = await getCardPriceHistory({
      mtgjsonUuid: card.mtgjsonUuid,
      provider,
      finish,
      priceType,
      currency,
      range,
    });
    return NextResponse.json({ available: true, card, ...history });
  } catch (error) {
    return NextResponse.json({
      available: false,
      card,
      provider,
      finish,
      priceType,
      currency,
      range,
      points: [],
      change: calculatePriceHistoryChange([]),
      error:
        error instanceof Error
          ? error.message
          : "Pricing history is unavailable.",
    });
  }
}
