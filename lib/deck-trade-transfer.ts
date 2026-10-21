import { Prisma } from "@prisma/client";
import { DeckTradeValidationError, normalizeDeckReceipt } from "./deck-trade-policy";
import { lockTradeDeckSources, readTradeDeck, validateDeckReceipt } from "./deck-trade-store";
import { assertDeckUnreserved } from "./deck-write-fence";

type Tx = Prisma.TransactionClient;
export type TradeDeckReceiptSelection = { bundleId: string } & Parameters<typeof normalizeDeckReceipt>[0];

export function parseTradeDeckReceipts(value: FormDataEntryValue | null): TradeDeckReceiptSelection[] {
  let input: unknown;
  try { input = value ? JSON.parse(String(value)) : []; }
  catch { throw new DeckTradeValidationError("Received deck settings are invalid."); }
  if (!Array.isArray(input)) throw new DeckTradeValidationError("Received deck settings are invalid.");
  const result = input.map(choice => {
    if (!choice || typeof choice !== "object" || typeof choice.bundleId !== "string" || !choice.bundleId.trim())
      throw new DeckTradeValidationError("Choose settings for every received deck.");
    return { bundleId: choice.bundleId.trim(), ...normalizeDeckReceipt(choice) };
  });
  if (new Set(result.map(choice => choice.bundleId)).size !== result.length)
    throw new DeckTradeValidationError("Choose settings once for every received deck.");
  return result;
}

async function lockedTrade(tx: Tx, tradeId: string) {
  await tx.$queryRaw`SELECT id FROM "Trade" WHERE id=${tradeId} FOR UPDATE`;
  const trade = await tx.trade.findUnique({ where: { id: tradeId }, include: {
    deckBundles: { include: { lines: true }, orderBy: [{ side: "asc" }, { position: "asc" }, { id: "asc" }] },
  } });
  if (!trade || !["ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"].includes(trade.status))
    throw new DeckTradeValidationError("This trade is not awaiting physical confirmation.");
  return trade;
}

/** Must share the transaction which conditionally records this participant's
 * physical confirmation. Organization choices never transfer ownership early. */
export async function recordTradeDeckReceipts(tx: Tx, tradeId: string, actorUserId: string, choices: TradeDeckReceiptSelection[]) {
  const trade = await lockedTrade(tx, tradeId);
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: {
    playerId: true, isActive: true, forcePasswordChange: true, player: { select: { active: true } },
  } });
  const proposer = actor?.playerId === trade.proposerPlayerId;
  if (!actor?.isActive || actor.forcePasswordChange || !actor.player?.active || !actor.playerId || (!proposer && actor.playerId !== trade.receiverPlayerId))
    throw new DeckTradeValidationError("Only trade participants can confirm the physical exchange.");
  if (proposer ? trade.proposerCommittedAt : trade.receiverCommittedAt)
    throw new DeckTradeValidationError("You have already confirmed this physical exchange.");
  const incoming = trade.deckBundles.filter(bundle => bundle.side === (proposer ? "RECEIVER" : "PROPOSER"));
  if (choices.length !== incoming.length || new Set(choices.map(choice => choice.bundleId)).size !== choices.length ||
      choices.some(choice => !incoming.some(bundle => bundle.id === choice.bundleId)))
    throw new DeckTradeValidationError("Choose organization and confirm visibility for every received deck.");
  await lockTradeDeckSources(tx, trade.deckBundles.map(bundle => {
    if (!bundle.deckId) throw new DeckTradeValidationError("A traded deck is unavailable.");
    return bundle.deckId;
  }), [actorUserId]);
  for (const bundle of trade.deckBundles) {
    const source = await readTradeDeck(tx, bundle.deckId!, bundle.side === "PROPOSER" ? trade.proposerPlayerId : trade.receiverPlayerId);
    if (source.digest !== bundle.snapshotDigest) throw new DeckTradeValidationError("A traded deck changed. Cancel this offer and review its contents again.");
    if (bundle.side === (proposer ? "PROPOSER" : "RECEIVER") && source.deck.ownerUserId !== actorUserId)
      throw new DeckTradeValidationError("Only the actual deck owner can confirm its transfer.");
  }
  for (const choice of choices) {
    const receipt = await validateDeckReceipt(tx, actorUserId, actor.playerId, choice);
    await tx.tradeDeckBundle.update({ where: { id: choice.bundleId }, data: { receiptJson: receipt } });
  }
}

function storedReceipt(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.ownerUserId !== "string")
    throw new DeckTradeValidationError("The recipient must choose organization and confirm deck visibility.");
  return { ...normalizeDeckReceipt(value), ownerUserId: value.ownerUserId };
}

/** Internal completion component. The caller completes loose-card movement,
 * final status, events and notifications in this SAME transaction. There is no
 * independent endpoint or admin bypass for the two confirmed deck receipts. */
export async function transferConfirmedTradeDecks(tx: Tx, tradeId: string, actorUserId: string) {
  const trade = await lockedTrade(tx, tradeId);
  if (!trade.proposerCommittedAt || !trade.receiverCommittedAt)
    throw new DeckTradeValidationError("Both participants must confirm before decks transfer.");
  const receipts = trade.deckBundles.map(bundle => ({ bundle, receipt: storedReceipt(bundle.receiptJson) }));
  await lockTradeDeckSources(tx, receipts.map(({ bundle }) => {
    if (!bundle.deckId) throw new DeckTradeValidationError("A traded deck is unavailable.");
    return bundle.deckId;
  }), receipts.map(({ receipt }) => receipt.ownerUserId));
  const sources: { bundle: typeof trade.deckBundles[number]; source: Awaited<ReturnType<typeof readTradeDeck>>;
    selected: Awaited<ReturnType<typeof validateDeckReceipt>>; receiverPlayerId: string }[] = [];
  for (const { bundle, receipt } of receipts) {
    const sourcePlayerId = bundle.side === "PROPOSER" ? trade.proposerPlayerId : trade.receiverPlayerId;
    const receiverPlayerId = bundle.side === "PROPOSER" ? trade.receiverPlayerId : trade.proposerPlayerId;
    const source = await readTradeDeck(tx, bundle.deckId!, sourcePlayerId);
    const selected = await validateDeckReceipt(tx, receipt.ownerUserId, receiverPlayerId, receipt);
    sources.push({ bundle, source, selected, receiverPlayerId });
  }
  const ids = [...new Set(sources.flatMap(({ source }) => source.stock.map(item => item.id)))].sort();
  for (let offset = 0; offset < ids.length; offset += 500)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "InventoryItem" WHERE id IN (${Prisma.join(ids.slice(offset, offset + 500))}) ORDER BY id FOR UPDATE`);
  for (const { bundle, selected, receiverPlayerId } of sources) {
    const source = await readTradeDeck(tx, bundle.deckId!, bundle.side === "PROPOSER" ? trade.proposerPlayerId : trade.receiverPlayerId);
    if (source.digest !== bundle.snapshotDigest) throw new DeckTradeValidationError("A traded deck changed. Cancel this offer and review its contents again.");
    await assertDeckUnreserved(tx, source.deck.id, trade.id);
    const positive = source.stock.filter(item => item.quantity > 0);
    if (bundle.lines.length !== positive.length || positive.some(item =>
      bundle.lines.filter(line => line.inventoryItemId === item.id && line.quantity === item.quantity && line.side === bundle.side).length !== 1))
      throw new DeckTradeValidationError("The whole-deck physical reservations no longer match its complete contents.");
    if (source.location && (await tx.inventoryLocation.count({ where: { parentLocationId: source.location.id } }) ||
        await tx.commanderLeagueLocation.count({ where: { locationId: source.location.id } })))
      throw new DeckTradeValidationError("Remove linked storage or League locations before trading this deck.");
    await tx.deck.update({ where: { id: source.deck.id }, data: {
      ownerUserId: selected.ownerUserId, folderId: selected.folderId, visibility: selected.visibility,
    } });
    await tx.deckTagAssignment.deleteMany({ where: { deckId: source.deck.id } });
    if (selected.tagIds.length) await tx.deckTagAssignment.createMany({ data: selected.tagIds.map(tagId => ({ deckId: source.deck.id, tagId })) });
    if (source.location) await tx.inventoryLocation.update({ where: { id: source.location.id }, data: {
      ownerPlayerId: receiverPlayerId, parentLocationId: null, visibility: selected.visibility,
    } });
    for (const item of source.stock) {
      const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { currentOwnerId: receiverPlayerId } });
      const beforeJson = source.snapshot.stock.find(row => row.id === item.id)!;
      await tx.inventoryAuditLog.create({ data: { inventoryItemId: item.id, tradeId, changedByUserId: actorUserId,
        changeType: "trade_deck_completed", beforeJson,
        afterJson: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonObject,
        reason: "Whole-deck transfer preserving its existing location, quantities and provenance.",
      } });
    }
  }
  return sources.map(({ bundle }) => bundle.id);
}
