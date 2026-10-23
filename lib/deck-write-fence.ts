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

/** An inherited visibility change is also a change to the reviewed source. */
export async function assertDeckDefaultVisibilityWritable(tx: Tx, ownerUserId: string, visibility: "PRIVATE" | "PUBLIC") {
  await lockDeckOwners(tx, [ownerUserId]);
  const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { deckDefaultVisibility: true } });
  if (!owner) throw new DeckTradeWriteError("Deck owner is unavailable.");
  if (owner.deckDefaultVisibility === visibility) return;
  const decks = await tx.deck.findMany({ where: { ownerUserId, visibility: "INHERIT" }, select: { id: true } });
  await lockDeckRows(tx, decks.map(deck => deck.id));
  for (const deck of decks) await assertDeckUnreserved(tx, deck.id);
}

/** Delete/zero cleanup must join the same order even for zero lots, which do
 * not have positive TradeLine reservation members. Refresh location after stock
 * locks; a source newly moved into an unobserved deck requires a retry/skip. */
export async function lockInventoryDeckSources(tx: Tx, inventoryItemIds: string[]) {
  if (!inventoryItemIds.length) return new Set<string>();
  const rows = await tx.inventoryItem.findMany({ where: { id: { in: inventoryItemIds } }, select: {
    location: { select: { deck: { select: { id: true, ownerUserId: true } } } },
  } });
  const decks = rows.flatMap(row => row.location?.deck ? [row.location.deck] : []);
  const expected = new Map(decks.map(deck => [deck.id, deck.ownerUserId]));
  await lockDeckOwners(tx, [...expected.values()]);
  await lockDeckRows(tx, [...expected.keys()]);
  const current = expected.size ? await tx.deck.findMany({ where: { id: { in: [...expected.keys()] } }, select: { id: true, ownerUserId: true } }) : [];
  if (current.length !== expected.size || current.some(deck => deck.ownerUserId !== expected.get(deck.id)))
    throw new DeckTradeWriteError("Deck storage ownership changed. Refresh and retry.");
  return new Set(current.map(deck => deck.id));
}

export async function assertInventoryDeckWritable(tx: Tx, locationId: string | null, lockedDeckIds: Set<string>) {
  if (!locationId) return;
  const location = await tx.inventoryLocation.findUnique({ where: { id: locationId }, select: { deckId: true } });
  if (!location?.deckId) return;
  if (!lockedDeckIds.has(location.deckId)) throw new DeckTradeWriteError("Deck storage changed. Refresh and retry.");
  await assertDeckUnreserved(tx, location.deckId);
}

