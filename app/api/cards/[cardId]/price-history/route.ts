import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  latestPricesByProvider,
  priceChangePercent,
  selectPreferredCardPrice,
} from "@/lib/price-history";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params;
  const url = request.nextUrl;
  const provider = url.searchParams.get("provider") || undefined;
  const finish = url.searchParams.get("finish") || undefined;
  const priceType = url.searchParams.get("priceType") || "retail";
  const days = Math.max(
    1,
    Math.min(365, Number(url.searchParams.get("days") || 90)),
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      name: true,
      setCode: true,
      collectorNumber: true,
      prices: true,
      priceSnapshots: {
        where: {
          observedDate: { gte: since },
          ...(provider ? { provider } : {}),
          ...(finish ? { finish } : {}),
          ...(priceType ? { priceType } : {}),
        },
        orderBy: [{ observedDate: "desc" }, { provider: "asc" }],
      },
    },
  });
  if (!card)
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const snapshots = card.priceSnapshots.map((snapshot) => ({
    provider: snapshot.provider,
    finish: snapshot.finish,
    priceType: snapshot.priceType,
    currency: snapshot.currency,
    price: snapshot.price.toString(),
    observedDate: snapshot.observedDate,
  }));
  const latest = selectPreferredCardPrice(snapshots, card.prices, {
    preferredProvider: provider,
    finish,
  });
  return NextResponse.json({
    card: {
      id: card.id,
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
    },
    latest,
    latestByProvider: latestPricesByProvider(snapshots),
    changes: {
      sevenDay: priceChangePercent(snapshots, 7, { provider, finish }),
      thirtyDay: priceChangePercent(snapshots, 30, { provider, finish }),
      ninetyDay: priceChangePercent(snapshots, 90, { provider, finish }),
    },
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      observedDate: new Date(snapshot.observedDate).toISOString().slice(0, 10),
    })),
  });
}
