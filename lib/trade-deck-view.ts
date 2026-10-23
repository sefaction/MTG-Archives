import type { TradeDeckSnapshot } from "./deck-trade-policy";

export type TradeDeckReview = {
  deckId: string; digest: string; name: string; format: string; description: string | null;
  cards: { cardId: string | null; scryfallId: string | null; name: string; section: string; quantity: number; isCommander: boolean }[];
  commitments: { cardId: string; name: string; printingLabel: string | null; scryfallId: string | null; foilStatus: string; condition: string; language: string; quantity: number }[];
  committedCopies: number; listedCopies: number; maybeboardCopies: number;
};
export type TradeDeckSearchItem = { deckId: string; name: string; format: string; listEntries: number; blockedReason: string | null };

/** Only display fields cross the client boundary. The opaque review digest
 * still binds the complete source, without exposing stock IDs, private notes,
 * provenance identities, folders/tags or storage organization. */
export function tradeDeckReview(snapshot: TradeDeckSnapshot, digest: string,
  publicCatalog: readonly { id: string; name: string; setCode: string; collectorNumber: string; scryfallId: string }[] = []): TradeDeckReview {
  const cards = snapshot.cards.map(card => ({ cardId: typeof card.cardId === "string" ? card.cardId : null,
    scryfallId: typeof card.scryfallId === "string" ? card.scryfallId : null,
    name: String(card.cardName), section: String(card.section), quantity: Number(card.quantity), isCommander: card.isCommander === true,
  }));
  const grouped = new Map<string, TradeDeckReview["commitments"][number]>();
  const catalog = new Map(publicCatalog.map(card => [card.id, card]));
  for (const item of snapshot.stock) {
    if (Number(item.quantity) <= 0) continue;
    const cardId = String(item.cardId), printed = catalog.get(cardId);
    const physical = { cardId, name: printed?.name ?? cards.find(card => card.cardId === cardId)?.name ?? "Unlisted committed printing",
      printingLabel: printed ? `${printed.setCode.toUpperCase()} #${printed.collectorNumber}` : null, scryfallId: printed?.scryfallId ?? null,
      foilStatus: String(item.foilStatus), condition: String(item.condition),
      language: String(item.language), quantity: Number(item.quantity) };
    const key = JSON.stringify([physical.cardId, physical.foilStatus, physical.condition, physical.language]);
    const current = grouped.get(key);
    if (current) current.quantity += physical.quantity;
    else grouped.set(key, physical);
  }
  const commitments = [...grouped.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value);
  return { deckId: String(snapshot.deck.id), digest, name: String(snapshot.deck.name), format: String(snapshot.deck.format),
    description: typeof snapshot.deck.description === "string" ? snapshot.deck.description : null,
    cards, commitments, committedCopies: commitments.reduce((sum, item) => sum + item.quantity, 0),
    listedCopies: cards.filter(card => card.section !== "MAYBEBOARD").reduce((sum, card) => sum + card.quantity, 0),
    maybeboardCopies: cards.filter(card => card.section === "MAYBEBOARD").reduce((sum, card) => sum + card.quantity, 0),
  };
}
