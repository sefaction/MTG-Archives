import { Prisma, TradeWishlistStatus } from "@prisma/client";

export type CompletedTradeWishlistInput = {
  proposerPlayerId: string;
  receiverPlayerId: string;
  offeredCardId?: string;
  requestedCardId?: string;
  offeredCards?: Array<{ cardId: string; quantity: number }>;
  requestedCards?: Array<{ cardId: string; quantity: number }>;
};

export type CompletedTradeWishlistMatch = {
  ownerPlayerId: string;
  targetOwnerPlayerId: string;
  cardId: string;
  quantity: number;
};

export function buildCompletedTradeWishlistMatches(
  input: CompletedTradeWishlistInput,
): CompletedTradeWishlistMatch[] {
  const matches = [
    ...(
      input.offeredCards ??
      (input.offeredCardId
        ? [{ cardId: input.offeredCardId, quantity: 1 }]
        : [])
    ).map((card) => ({
      ownerPlayerId: input.receiverPlayerId,
      targetOwnerPlayerId: input.proposerPlayerId,
      ...card,
    })),
    ...(
      input.requestedCards ??
      (input.requestedCardId
        ? [{ cardId: input.requestedCardId, quantity: 1 }]
        : [])
    ).map((card) => ({
      ownerPlayerId: input.proposerPlayerId,
      targetOwnerPlayerId: input.receiverPlayerId,
      ...card,
    })),
  ];
  const grouped = new Map<string, CompletedTradeWishlistMatch>();
  for (const match of matches) {
    const key = [
      match.ownerPlayerId,
      match.targetOwnerPlayerId,
      match.cardId,
    ].join("|");
    const existing = grouped.get(key);
    if (existing) existing.quantity += match.quantity;
    else grouped.set(key, { ...match });
  }
  return Array.from(grouped.values());
}

export async function fulfillCompletedTradeWishlists(
  tx: Prisma.TransactionClient,
  input: CompletedTradeWishlistInput,
) {
  const activeStatuses = [
    TradeWishlistStatus.OPEN,
    TradeWishlistStatus.IN_TRADE,
  ];

  await Promise.all(
    buildCompletedTradeWishlistMatches(input).map(async (match) => {
      const where = {
        ownerUser: { playerId: match.ownerPlayerId },
        targetOwnerPlayerId: match.targetOwnerPlayerId,
        cardId: match.cardId,
        status: { in: activeStatuses },
      };

      await tx.tradeWishlistItem.updateMany({
        where: { ...where, quantity: { lte: match.quantity } },
        data: { status: TradeWishlistStatus.FULFILLED },
      });
      await tx.tradeWishlistItem.updateMany({
        where: { ...where, quantity: { gt: match.quantity } },
        data: { quantity: { decrement: match.quantity } },
      });
    }),
  );
}
