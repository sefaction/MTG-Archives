import { Prisma, TradeWishlistStatus } from "@prisma/client";

export type CompletedTradeWishlistInput = {
  proposerPlayerId: string;
  receiverPlayerId: string;
  offeredCardId: string;
  requestedCardId: string;
};

export type CompletedTradeWishlistMatch = {
  ownerPlayerId: string;
  targetOwnerPlayerId: string;
  cardId: string;
};

export function buildCompletedTradeWishlistMatches(
  input: CompletedTradeWishlistInput,
): CompletedTradeWishlistMatch[] {
  return [
    {
      ownerPlayerId: input.receiverPlayerId,
      targetOwnerPlayerId: input.proposerPlayerId,
      cardId: input.offeredCardId,
    },
    {
      ownerPlayerId: input.proposerPlayerId,
      targetOwnerPlayerId: input.receiverPlayerId,
      cardId: input.requestedCardId,
    },
  ];
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

      // A completed 1-for-1 trade satisfies one requested copy. Preserve an
      // entry that still requests additional copies from this same person.
      await tx.tradeWishlistItem.updateMany({
        where: { ...where, quantity: { lte: 1 } },
        data: { status: TradeWishlistStatus.FULFILLED },
      });
      await tx.tradeWishlistItem.updateMany({
        where: { ...where, quantity: { gt: 1 } },
        data: { quantity: { decrement: 1 } },
      });
    }),
  );
}
