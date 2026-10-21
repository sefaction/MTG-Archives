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
  await Promise.all(
    buildCompletedTradeWishlistMatches(input).map(async (match) => {
      // Decide fulfillment and remaining quantity from the same locked row.
      // Separate conditional updates can both miss fulfillment before either
      // transaction decrements the row, losing one concurrent receipt.
      await tx.$executeRaw`
        UPDATE "TradeWishlistItem" w
        SET status = CASE WHEN w.quantity <= ${match.quantity}
              THEN ${TradeWishlistStatus.FULFILLED}::"TradeWishlistStatus" ELSE w.status END,
            quantity = CASE WHEN w.quantity > ${match.quantity}
              THEN w.quantity - ${match.quantity} ELSE w.quantity END,
            "updatedAt" = clock_timestamp()
        FROM "User" u
        WHERE u.id = w."ownerUserId" AND u."playerId" = ${match.ownerPlayerId}
          AND w."targetOwnerPlayerId" = ${match.targetOwnerPlayerId}
          AND w."cardId" = ${match.cardId}
          AND w.status IN (${TradeWishlistStatus.OPEN}::"TradeWishlistStatus",
            ${TradeWishlistStatus.IN_TRADE}::"TradeWishlistStatus")
      `;
    }),
  );
}
