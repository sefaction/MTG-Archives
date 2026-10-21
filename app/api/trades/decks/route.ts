import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readTradeDeck, isDeckTradeUserError } from "@/lib/deck-trade-store";
import { activeDeckTradeStatuses, assertDeckUnreserved } from "@/lib/deck-write-fence";
import { tradeDeckReview } from "@/lib/trade-deck-view";

export async function GET(request: Request) {
  const actor = await requireLogin();
  const params = new URL(request.url).searchParams;
  const side = params.get("side"), ownerId = params.get("ownerId");
  if (!ownerId || (side !== "offered" && side !== "requested")) return NextResponse.json({ items: [], nextCursor: null });
  if (!actor.playerId || (side === "offered" ? ownerId !== actor.playerId : ownerId === actor.playerId))
    return NextResponse.json({ error: "Choose a different trade partner and offer decks from your own account." }, { status: 403 });
  const counterId = params.get("counterTradeId") || undefined;
  let sharedIds: string[] = [];
  if (counterId) {
    const parent = await prisma.trade.findUnique({ where: { id: counterId }, include: {
      deckBundles: { include: { deck: { select: { ownerUserId: true } } } },
    } });
    if (!parent || parent.status !== "PROPOSED" || parent.receiverPlayerId !== actor.playerId ||
        (side === "requested" && parent.proposerPlayerId !== ownerId))
      return NextResponse.json({ error: "This counter proposal is unavailable. Refresh the trade." }, { status: 404 });
    sharedIds = parent.deckBundles.filter(bundle => bundle.side === "PROPOSER" && bundle.deck?.ownerUserId === parent.createdByUserId)
      .flatMap(bundle => bundle.deckId ? [bundle.deckId] : []);
  }
  const where: Prisma.DeckWhereInput = {
    ownerUser: { playerId: ownerId, isActive: true, player: { active: true } },
    ...(side === "offered" ? { ownerUserId: actor.id } : { OR: [
      { visibility: "PUBLIC" }, { visibility: "INHERIT", ownerUser: { deckDefaultVisibility: "PUBLIC" } },
      ...(sharedIds.length ? [{ id: { in: sharedIds } }] : []),
    ] }),
  };
  const deckId = params.get("deckId");
  if (deckId) {
    if (!await prisma.deck.findFirst({ where: { AND: [where, { id: deckId }] }, select: { id: true } }))
      return NextResponse.json({ error: "This deck is unavailable to review." }, { status: 404 });
    try {
      const review = await prisma.$transaction(async tx => {
        await assertDeckUnreserved(tx, deckId, counterId);
        const source = await readTradeDeck(tx, deckId, ownerId);
        return tradeDeckReview(source.snapshot, source.digest);
      });
      return NextResponse.json({ review });
    } catch (error) {
      if (isDeckTradeUserError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "This deck is unavailable." }, { status: 409 });
      throw error;
    }
  }
  const query = (params.get("q") || "").trim().slice(0, 160), cursor = params.get("cursor");
  const rows = await prisma.deck.findMany({ where: { AND: [where,
    ...(query ? [{ name: { contains: query, mode: "insensitive" as const } }] : []), ...(cursor ? [{ id: { gt: cursor } }] : []),
  ] }, orderBy: { id: "asc" }, take: 25, select: { id: true, name: true, format: true,
    _count: { select: { cards: true } }, commanderLeagueDeck: { select: { id: true } },
    tradeBundles: { where: { trade: { status: { in: activeDeckTradeStatuses }, ...(counterId ? { id: { not: counterId } } : {}) } }, take: 1, select: { id: true } },
  } });
  const page = rows.slice(0, 24);
  return NextResponse.json({ items: page.map(deck => ({ deckId: deck.id, name: deck.name, format: deck.format, listEntries: deck._count.cards,
    blockedReason: deck.commanderLeagueDeck ? "League-linked decks cannot be traded." : deck.tradeBundles.length ? "Reserved in an active trade." : null,
  })), nextCursor: rows.length > 24 ? page[page.length - 1].id : null });
}
