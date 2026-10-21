import { Prisma, TradeStatus } from "@prisma/client";
type Tx = Prisma.TransactionClient;
export class DeckTradeWriteError extends Error {
  constructor(message: string) { super(message); this.name = "DeckTradeWriteError"; }
}
export const activeDeckTradeStatuses: TradeStatus[] = [TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE, TradeStatus.PARTIALLY_COMMITTED];

/** Shared order: existing Trade (if any), sorted owner gates, sorted Deck rows,
 * then sorted InventoryItem rows. Owner gates fence folder/tag bulk mutations
 * and new commitments as well as existing rows. Never acquire them after stock. */
export async function lockDeckOwners(tx: Tx, ownerUserIds: string[]) {
  for (const ownerUserId of [...new Set(ownerUserIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerUserId}, 807))`;
  }
}

export async function lockDeckRows(tx: Tx, ids: string[]) {
  const ordered = [...new Set(ids)].sort();
  for (let offset = 0; offset < ordered.length; offset += 500) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Deck" WHERE id IN (${Prisma.join(ordered.slice(offset, offset + 500))}) ORDER BY id FOR UPDATE`);
  }
}

export async function assertDeckUnreserved(tx: Tx, deckId: string, ignoredTradeId?: string) {
  const reserved = await tx.tradeDeckBundle.findFirst({ where: { deckId,
    trade: { status: { in: activeDeckTradeStatuses }, ...(ignoredTradeId ? { id: { not: ignoredTradeId } } : {}) },
  }, select: { id: true } });
  if (reserved) throw new DeckTradeWriteError("This whole deck is reserved in an active trade. Cancel or decline that offer before editing it.");
}

/** Existing writer entrypoints carry the owner observed by their ordinary
 * permission check. A transfer during that preflight must not grant access to
 * the new owner's deck, even if no active reservation remains afterward. */
export async function lockWritableDeck(tx: Tx, deckId: string, expectedOwnerUserId: string) {
  await lockDeckOwners(tx, [expectedOwnerUserId]);
  await lockDeckRows(tx, [deckId]);
  const deck = await tx.deck.findUnique({ where: { id: deckId } });
  if (!deck || deck.ownerUserId !== expectedOwnerUserId) throw new DeckTradeWriteError("Deck ownership changed. Refresh and retry.");
  await assertDeckUnreserved(tx, deckId);
  return deck;
}

