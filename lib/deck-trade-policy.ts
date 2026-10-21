import { createHash } from "node:crypto";
import type { Deck, DeckCard, InventoryItem, InventoryLocation, Prisma } from "@prisma/client";

export class DeckTradeValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DeckTradeValidationError"; }
}
export type TradeDeckSelection = { deckId: string; digest: string };

export function parseTradeDeckSelections(value: FormDataEntryValue | null): TradeDeckSelection[] {
  if (!value) return [];
  let input: unknown;
  try { input = JSON.parse(String(value)); } catch { throw new DeckTradeValidationError("Trade deck selections are invalid."); }
  if (!Array.isArray(input)) throw new DeckTradeValidationError("Trade deck selections are invalid.");
  const selections = input.map(value => {
    if (!value || typeof value !== "object" || typeof value.deckId !== "string" || !value.deckId.trim() ||
        typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest))
      throw new DeckTradeValidationError("Refresh and review each whole deck before proposing it.");
    return { deckId: value.deckId.trim(), digest: value.digest };
  });
  normalizeTradeDeckIds(selections.map(selection => selection.deckId));
  return selections;
}

export type DeckTradeSource = {
  deck: Deck;
  cards: DeckCard[];
  location: InventoryLocation | null;
  stock: (InventoryItem & { card: { name: string; scryfallId: string } })[];
  tagIds: string[];
  ownerPlayerId: string;
  leagueLinked: boolean;
  effectiveVisibility: "PRIVATE" | "PUBLIC";
};

// Explicit scalar projections prevent included user/account/catalog/audit
// relations from entering a participant-visible historical bundle snapshot.
const deckFields = ["id", "ownerUserId", "name", "description", "format", "visibility",
  "bracket", "bracketSuggested", "bracketConfidence", "bracketAnalysisJson", "bracketUpdatedAt",
  "bracketAnalyzedAt", "bannerPositionX", "bannerPositionY", "bannerZoom", "folderId", "createdAt", "updatedAt"] as const;
const cardFields = ["id", "deckId", "cardId", "scryfallId", "oracleId", "cardName", "section",
  "quantity", "isCommander", "notes", "createdAt", "updatedAt"] as const;
const locationFields = ["id", "ownerPlayerId", "parentLocationId", "name", "normalizedName", "description",
  "type", "storageLayout", "capacityRevision", "kind", "deckId", "systemManaged", "active", "visibility",
  "createdAt", "updatedAt"] as const;
const stockFields = ["id", "currentOwnerId", "originalOpenerId", "cardId", "quantity", "foil", "foilStatus",
  "sourceType", "condition", "locationId", "locationSection", "language", "acquiredFromPullId", "roundId",
  "notes", "createdAt", "updatedAt"] as const;

function project(source: object, fields: readonly string[]) {
  const values = source as Record<string, unknown>;
  return Object.fromEntries(fields.map(field => [field, values[field]]));
}
function ordered<T extends { id: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new DeckTradeValidationError("The deck snapshot contains invalid data.");
  return encoded;
}

export function normalizeTradeDeckIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.some(id => typeof id !== "string" || !id.trim()))
    throw new DeckTradeValidationError("Trade deck selections are invalid.");
  const ids = input.map(id => String(id).trim());
  if (new Set(ids).size !== ids.length) throw new DeckTradeValidationError("Each whole deck can appear only once in an offer.");
  return ids;
}

export function parseTradeDeckIds(value: FormDataEntryValue | null): string[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new DeckTradeValidationError("Trade deck selections are invalid."); }
  return normalizeTradeDeckIds(parsed);
}

/** Domain eligibility, not authorization. Callers must freshly authenticate,
 * check source privacy/ownership and acquire the shared source locks first. */
export function snapshotTradeDeck(source: DeckTradeSource) {
  if (source.leagueLinked) throw new DeckTradeValidationError("League-linked decks cannot be traded.");
  if (!source.deck.id || !source.deck.ownerUserId || !source.ownerPlayerId)
    throw new DeckTradeValidationError("The deck owner is unavailable.");
  if (source.effectiveVisibility !== "PRIVATE" && source.effectiveVisibility !== "PUBLIC")
    throw new DeckTradeValidationError("The deck visibility is unavailable.");
  const ids = new Set<string>();
  for (const card of source.cards) {
    if (card.deckId !== source.deck.id || ids.has(card.id) || !Number.isInteger(card.quantity) || card.quantity < 1)
      throw new DeckTradeValidationError("The deck list has inconsistent entries.");
    ids.add(card.id);
  }
  if (source.location && (source.location.deckId !== source.deck.id || source.location.kind !== "DECK" ||
      !source.location.systemManaged || source.location.ownerPlayerId !== source.ownerPlayerId || !source.location.active))
    throw new DeckTradeValidationError("The deck location is inconsistent. Repair it before trading.");
  const maybeIds = new Set(source.cards.filter(card => card.section === "MAYBEBOARD" && card.cardId).map(card => card.cardId));
  const unresolvedMaybe = source.cards.filter(card => card.section === "MAYBEBOARD" && !card.cardId);
  ids.clear();
  for (const item of source.stock) {
    if (!source.location || item.locationId !== source.location.id || item.currentOwnerId !== source.ownerPlayerId ||
        ids.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 0)
      throw new DeckTradeValidationError("The committed deck inventory is inconsistent. Repair it before trading.");
    ids.add(item.id);
    const ambiguous = unresolvedMaybe.some(card => card.scryfallId
      ? card.scryfallId === item.card.scryfallId
      : card.cardName.trim().toLowerCase() === item.card.name.trim().toLowerCase());
    if (item.quantity > 0 && (maybeIds.has(item.cardId) || ambiguous))
      throw new DeckTradeValidationError("Return physical Maybeboard copies or remove the section ambiguity before trading this deck.");
  }
  // JSON cloning normalizes dates and prevents later caller mutation changing
  // the reviewed payload. Zero rows remain bound: location ownership moves too.
  const snapshot = JSON.parse(JSON.stringify({ version: 1, ownerPlayerId: source.ownerPlayerId, effectiveVisibility: source.effectiveVisibility,
    deck: project(source.deck, deckFields), cards: ordered(source.cards).map(card => project(card, cardFields)),
    location: source.location ? project(source.location, locationFields) : null,
    stock: ordered(source.stock).map(item => project(item, stockFields)), tagIds: [...new Set(source.tagIds)].sort(),
  })) as {
    version: number; ownerPlayerId: string; effectiveVisibility: "PRIVATE" | "PUBLIC"; deck: Prisma.JsonObject; cards: Prisma.JsonObject[];
    location: Prisma.JsonObject | null; stock: Prisma.JsonObject[]; tagIds: string[];
  };
  return { snapshot, digest: createHash("sha256").update(canonical(snapshot)).digest("hex") };
}

export type TradeDeckSnapshot = ReturnType<typeof snapshotTradeDeck>["snapshot"];

export function normalizeDeckReceipt(input: { visibility?: unknown; folderId?: unknown; tagIds?: unknown }) {
  if (input.visibility !== "PRIVATE" && input.visibility !== "PUBLIC")
    throw new DeckTradeValidationError("Choose and confirm visibility for every received deck.");
  if (input.folderId !== undefined && input.folderId !== null && typeof input.folderId !== "string")
    throw new DeckTradeValidationError("Choose a valid folder for the received deck.");
  const folderId = typeof input.folderId === "string" ? input.folderId.trim() || null : null;
  const tags = input.tagIds ?? [];
  if (!Array.isArray(tags) || tags.some(id => typeof id !== "string" || !id.trim()))
    throw new DeckTradeValidationError("Deck tag selections are invalid.");
  const tagIds = tags.map(id => String(id).trim());
  if (new Set(tagIds).size !== tagIds.length) throw new DeckTradeValidationError("Deck tag selections are invalid.");
  // Ownership of these organization IDs is checked inside the final transaction.
  return { visibility: input.visibility, folderId, tagIds } as {
    visibility: "PRIVATE" | "PUBLIC"; folderId: string | null; tagIds: string[];
  };
}
