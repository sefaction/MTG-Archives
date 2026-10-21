import { Prisma, TradeStatus } from "@prisma/client";
import { snapshotTradeDeck, normalizeDeckReceipt } from "./deck-trade-policy";
import { findSystemDeckLocation } from "./deck-inventory";
import { resolveDeckVisibility } from "./visibility";

type Tx = Prisma.TransactionClient;
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
  if (reserved) throw new Error("This whole deck is reserved in an active trade. Cancel or decline that offer before editing it.");
}

/** Existing writer entrypoints carry the owner observed by their ordinary
 * permission check. A transfer during that preflight must not grant access to
 * the new owner's deck, even if no active reservation remains afterward. */
export async function lockWritableDeck(tx: Tx, deckId: string, expectedOwnerUserId: string) {
  await lockDeckOwners(tx, [expectedOwnerUserId]);
  await lockDeckRows(tx, [deckId]);
  const deck = await tx.deck.findUnique({ where: { id: deckId } });
  if (!deck || deck.ownerUserId !== expectedOwnerUserId) throw new Error("Deck ownership changed. Refresh and retry.");
  await assertDeckUnreserved(tx, deckId);
  return deck;
}

export async function readTradeDeck(tx: Tx, deckId: string, expectedOwnerPlayerId: string) {
  const deck = await tx.deck.findUnique({ where: { id: deckId }, include: {
    cards: true, tags: { select: { tagId: true } }, deckLocation: true,
    commanderLeagueDeck: { select: { id: true } },
    ownerUser: { select: { id: true, playerId: true, isActive: true, deckDefaultVisibility: true,
      player: { select: { active: true } } } },
  } });
  if (!deck || !deck.ownerUser.isActive || !deck.ownerUser.player?.active || deck.ownerUser.playerId !== expectedOwnerPlayerId)
    throw new Error("The selected deck is unavailable for this trade partner.");
  let location = deck.deckLocation;
  if (!location) {
    const legacy = await findSystemDeckLocation(tx, { deckId, ownerPlayerId: expectedOwnerPlayerId });
    if (legacy) location = await tx.inventoryLocation.findUnique({ where: { id: legacy.id } });
  }
  const stock = location ? await tx.inventoryItem.findMany({ where: { locationId: location.id },
    include: { card: true, currentOwner: true, location: true }, orderBy: { id: "asc" },
  }) : [];
  const reviewed = snapshotTradeDeck({ deck, cards: deck.cards, location, stock,
    ownerPlayerId: expectedOwnerPlayerId, tagIds: deck.tags.map(tag => tag.tagId), leagueLinked: !!deck.commanderLeagueDeck });
  return { deck, location, stock, ...reviewed,
    effectiveVisibility: resolveDeckVisibility(deck.ownerUser.deckDefaultVisibility, deck.visibility) };
}

export async function lockTradeDeckSources(tx: Tx, deckIds: string[], additionalOwnerUserIds: string[] = []) {
  const ids = [...new Set(deckIds)].sort();
  const before = await tx.deck.findMany({ where: { id: { in: ids } }, select: { id: true, ownerUserId: true } });
  if (before.length !== ids.length) throw new Error("A selected whole deck is unavailable.");
  await lockDeckOwners(tx, [...before.map(deck => deck.ownerUserId), ...additionalOwnerUserIds]);
  await lockDeckRows(tx, ids);
  const current = await tx.deck.findMany({ where: { id: { in: ids } }, select: { id: true, ownerUserId: true } });
  if (current.length !== ids.length || current.some(deck => before.find(old => old.id === deck.id)?.ownerUserId !== deck.ownerUserId))
    throw new Error("Deck ownership changed. Refresh and retry.");
  return current;
}

/** The receiving user is the authenticated person choosing these settings,
 * never an arbitrary first User attached to the participant Player record. */
export async function validateDeckReceipt(tx: Tx, userId: string, ownerPlayerId: string,
  input: Parameters<typeof normalizeDeckReceipt>[0]) {
  const choice = normalizeDeckReceipt(input);
  const user = await tx.user.findUnique({ where: { id: userId }, select: {
    id: true, playerId: true, isActive: true, forcePasswordChange: true, player: { select: { active: true } },
  } });
  if (!user?.isActive || user.forcePasswordChange || !user.player?.active || user.playerId !== ownerPlayerId)
    throw new Error("The receiving deck owner is unavailable.");
  if (choice.folderId && !await tx.deckFolder.findFirst({ where: { id: choice.folderId, ownerUserId: user.id }, select: { id: true } }))
    throw new Error("Choose a folder from your own deck library.");
  if (choice.tagIds.length && await tx.deckTag.count({ where: { id: { in: choice.tagIds }, ownerUserId: user.id } }) !== choice.tagIds.length)
    throw new Error("Choose tags from your own deck library.");
  return { ...choice, ownerUserId: user.id };
}
