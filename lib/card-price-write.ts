import type { Card, Prisma } from "@prisma/client";
import type { ScryfallCard } from "./scryfall";

export function scryfallPricesForWrite(card: ScryfallCard) {
  const prices = card.prices ? { ...card.prices } : null;
  // Only the Pricing worker owns this projection. Cached callers may carry an
  // older copy alongside Scryfall's flat fields; never publish that copy.
  if (prices) delete prices.mtgjson;
  return prices;
}

// Call after the metadata write has acquired the Card row lock, in the same
// transaction. SQL reads the latest Pricing subtree rather than a stale JS copy.
export async function refreshScryfallPrices(
  tx: Prisma.TransactionClient,
  cardId: string,
  prices: NonNullable<ScryfallCard["prices"]>,
) {
  const [updated] = await tx.$queryRaw<Card[]>`
    UPDATE "Card"
    SET prices = ${JSON.stringify(prices)}::jsonb ||
      CASE WHEN jsonb_typeof(prices::jsonb) = 'object' AND prices::jsonb ? 'mtgjson'
        THEN jsonb_build_object('mtgjson', prices::jsonb->'mtgjson')
        ELSE '{}'::jsonb END
    WHERE id = ${cardId}
    RETURNING *
  `;
  if (!updated)
    throw new Error("Card price refresh did not return its updated card.");
  return updated;
}
