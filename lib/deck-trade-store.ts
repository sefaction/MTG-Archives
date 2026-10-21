import { assertCanCounterTrade } from "./trade-policy";
import { randomUUID } from "node:crypto";
import { TradeLineSide, type Prisma } from "@prisma/client";
import { snapshotTradeDeck, normalizeDeckReceipt, DeckTradeValidationError, type TradeDeckSelection } from "./deck-trade-policy";
import { findSystemDeckLocation } from "./deck-inventory";
import { resolveDeckVisibility } from "./visibility";

type Tx = Prisma.TransactionClient;
export { activeDeckTradeStatuses, lockDeckOwners, lockDeckRows, assertDeckUnreserved, lockWritableDeck } from "./deck-write-fence";
import { lockDeckOwners, lockDeckRows, assertDeckUnreserved, DeckTradeWriteError } from "./deck-write-fence";
export async function readTradeDeck(tx: Tx, deckId: string, expectedOwnerPlayerId: string) {
  const deck = await tx.deck.findUnique({ where: { id: deckId }, include: {
    cards: true, tags: { select: { tagId: true } }, deckLocation: true,
    commanderLeagueDeck: { select: { id: true } },
    ownerUser: { select: { id: true, playerId: true, isActive: true, deckDefaultVisibility: true,
      player: { select: { active: true } } } },
  } });
  if (!deck || !deck.ownerUser.isActive || !deck.ownerUser.player?.active || deck.ownerUser.playerId !== expectedOwnerPlayerId)
    throw new DeckTradeValidationError("The selected deck is unavailable for this trade partner.");
  let location = deck.deckLocation;
  if (!location) {
    const legacy = await findSystemDeckLocation(tx, { deckId, ownerPlayerId: expectedOwnerPlayerId });
    if (legacy) location = await tx.inventoryLocation.findUnique({ where: { id: legacy.id } });
  }
  const stock = location ? await tx.inventoryItem.findMany({ where: { locationId: location.id },
    include: { card: true, currentOwner: true, location: true }, orderBy: { id: "asc" },
  }) : [];
  const effectiveVisibility = resolveDeckVisibility(deck.ownerUser.deckDefaultVisibility, deck.visibility);
  const reviewed = snapshotTradeDeck({ deck, cards: deck.cards, location, stock, effectiveVisibility,
    ownerPlayerId: expectedOwnerPlayerId, tagIds: deck.tags.map(tag => tag.tagId), leagueLinked: !!deck.commanderLeagueDeck });
  return { deck, location, stock, ...reviewed, effectiveVisibility };
}

export async function lockTradeDeckSources(tx: Tx, deckIds: string[], additionalOwnerUserIds: string[] = []) {
  const ids = [...new Set(deckIds)].sort();
  const before = await tx.deck.findMany({ where: { id: { in: ids } }, select: { id: true, ownerUserId: true } });
  if (before.length !== ids.length) throw new DeckTradeValidationError("A selected whole deck is unavailable.");
  await lockDeckOwners(tx, [...before.map(deck => deck.ownerUserId), ...additionalOwnerUserIds]);
  await lockDeckRows(tx, ids);
  const current = await tx.deck.findMany({ where: { id: { in: ids } }, select: { id: true, ownerUserId: true } });
  if (current.length !== ids.length || current.some(deck => before.find(old => old.id === deck.id)?.ownerUserId !== deck.ownerUserId))
    throw new DeckTradeValidationError("Deck ownership changed. Refresh and retry.");
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
    throw new DeckTradeValidationError("The receiving deck owner is unavailable.");
  if (choice.folderId && !await tx.deckFolder.findFirst({ where: { id: choice.folderId, ownerUserId: user.id }, select: { id: true } }))
    throw new DeckTradeValidationError("Choose a folder from your own deck library.");
  if (choice.tagIds.length && await tx.deckTag.count({ where: { id: { in: choice.tagIds }, ownerUserId: user.id } }) !== choice.tagIds.length)
    throw new DeckTradeValidationError("Choose tags from your own deck library.");
  return { ...choice, ownerUserId: user.id };
}

export function isDeckTradeUserError(error: unknown) {
  return error instanceof DeckTradeValidationError || error instanceof DeckTradeWriteError;
}

export type PreparedTradeDeck = {
  id: string; deckId: string; side: TradeLineSide; position: number;
  source: Awaited<ReturnType<typeof readTradeDeck>>;
};

/** The reviewed digest comes from the user's displayed server snapshot. Do not
 * silently substitute a newer deck after selection. Actor identity is a User,
 * not an arbitrary account sharing the participant Player. */
export async function prepareTradeDeckBundles(tx: Tx, input: {
  actorUserId: string; proposerPlayerId: string; receiverPlayerId: string;
  offered: TradeDeckSelection[]; requested: TradeDeckSelection[]; counterTradeId?: string;
}): Promise<PreparedTradeDeck[]> {
  const all = [...input.offered, ...input.requested];
  if (!all.length) return [];
  const ids = all.map(selection => selection.deckId);
  if (new Set(ids).size !== ids.length) throw new DeckTradeValidationError("A whole deck can appear only once in an offer.");
  const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: {
    id: true, playerId: true, isActive: true, forcePasswordChange: true, player: { select: { active: true } },
  } });
  if (!actor?.isActive || actor.forcePasswordChange || !actor.player?.active || actor.playerId !== input.proposerPlayerId)
    throw new DeckTradeValidationError("Propose whole-deck trades from the actual owner's account.");
  if (input.proposerPlayerId === input.receiverPlayerId)
    throw new DeckTradeValidationError("Proposer and recipient must be different users.");
  if (input.counterTradeId) await tx.$queryRaw`SELECT id FROM "Trade" WHERE id=${input.counterTradeId} FOR UPDATE`;
  const counter = input.counterTradeId ? await tx.trade.findUnique({ where: { id: input.counterTradeId }, select: {
    proposerPlayerId: true, receiverPlayerId: true, status: true, createdByUserId: true,
    deckBundles: { select: { deckId: true, side: true } },
  } }) : null;
  if (input.counterTradeId) {
    if (!counter) throw new DeckTradeValidationError("The trade being countered is unavailable.");
    try { assertCanCounterTrade({ actorOwnerId: actor.playerId, isAdmin: false,
      proposerOwnerId: counter.proposerPlayerId, recipientOwnerId: counter.receiverPlayerId, status: counter.status,
      counterProposerOwnerId: input.proposerPlayerId, counterRecipientOwnerId: input.receiverPlayerId });
    } catch (error) { throw new DeckTradeValidationError(error instanceof Error ? error.message : "This trade cannot be countered."); }
  }
  await lockTradeDeckSources(tx, ids, [actor.id]);
  const result: PreparedTradeDeck[] = [], requestedOwners = new Set<string>();
  for (const [side, selections, ownerPlayerId] of [
    [TradeLineSide.PROPOSER, input.offered, input.proposerPlayerId],
    [TradeLineSide.RECEIVER, input.requested, input.receiverPlayerId],
  ] as const) {
    for (const [position, selection] of selections.entries()) {
      const source = await readTradeDeck(tx, selection.deckId, ownerPlayerId);
      if (side === TradeLineSide.PROPOSER && source.deck.ownerUserId !== actor.id)
        throw new DeckTradeValidationError("Only the actual deck owner can offer this whole deck.");
      if (side === TradeLineSide.RECEIVER) {
        requestedOwners.add(source.deck.ownerUserId);
        // Only a deck its actual owner offered in the parent proposal carries
        // explicit private sharing into a counter. Merely requesting it does not.
        const previouslyOfferedByOwner = counter?.createdByUserId === source.deck.ownerUserId && counter.deckBundles.some(bundle =>
          bundle.deckId === source.deck.id && bundle.side === TradeLineSide.PROPOSER);
        if (source.effectiveVisibility !== "PUBLIC" && !previouslyOfferedByOwner)
          throw new DeckTradeValidationError("A selected deck is unavailable to request. Ask its owner to offer it.");
      }
      if (selection.digest !== source.digest)
        throw new DeckTradeValidationError("A selected deck changed. Refresh and review its complete contents before proposing it.");
      await assertDeckUnreserved(tx, selection.deckId, input.counterTradeId);
      result.push({ id: randomUUID(), deckId: selection.deckId, side, position, source });
    }
  }
  if (requestedOwners.size > 1)
    throw new DeckTradeValidationError("All whole decks requested on a side must belong to the same user who will consent.");
  return result;
}

/** Call after all stock locks, before creating any bundle/line or changing an
 * existing offer. Owner gates remain held throughout this transaction. */
export async function revalidatePreparedTradeDecks(tx: Tx, bundles: PreparedTradeDeck[]) {
  return Promise.all(bundles.map(async bundle => {
    const current = await readTradeDeck(tx, bundle.deckId, bundle.source.snapshot.ownerPlayerId);
    if (current.digest !== bundle.source.digest)
      throw new DeckTradeValidationError("A selected deck changed. Refresh and review its complete contents before proposing it.");
    return { ...bundle, source: current };
  }));
}
