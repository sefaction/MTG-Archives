export type PublicTradeWishlistSource = {
  ownerPlayerId: string;
  ownerName: string;
  ownerColor?: string | null;
  inventoryItemId: string;
  cardId: string;
  setCode: string;
  collectorNumber: string;
  foilStatus?: string | null;
  condition?: string | null;
  language?: string | null;
  quantity: number;
};

export type PublicTradeWishlistTarget = {
  inventoryItemId: string;
  ownerName: string;
  ownerColor?: string;
  setCode: string;
  collectorNumber: string;
  foilStatus?: string;
  condition?: string;
  language?: string;
  availableQuantity: number;
  wishlistItemId?: string;
  wishlistedQuantity?: number;
};

export type OpenTradeWishlistMatch = {
  id: string;
  targetOwnerPlayerId: string;
  cardId: string;
  quantity: number;
};

export function publicTradeWishlistKey(ownerPlayerId: string, cardId: string) {
  return `${ownerPlayerId}|${cardId}`;
}

export function buildPublicTradeWishlistTargets(
  sources: PublicTradeWishlistSource[],
  viewerPlayerId?: string | null,
  openWishlist: OpenTradeWishlistMatch[] = [],
): PublicTradeWishlistTarget[] {
  const targets = new Map<string, PublicTradeWishlistTarget>();
  const wishlistByOwnerAndCard = new Map(
    openWishlist.map((item) => [
      publicTradeWishlistKey(item.targetOwnerPlayerId, item.cardId),
      item,
    ]),
  );

  for (const source of sources) {
    if (!source.inventoryItemId || source.ownerPlayerId === viewerPlayerId) {
      continue;
    }

    const key = [
      source.ownerPlayerId,
      source.cardId,
      source.foilStatus ?? "",
      source.condition ?? "",
      source.language ?? "",
    ].join("|");
    const existing = targets.get(key);
    if (existing) {
      existing.availableQuantity += source.quantity;
      continue;
    }

    const wishlistItem = wishlistByOwnerAndCard.get(
      publicTradeWishlistKey(source.ownerPlayerId, source.cardId),
    );
    targets.set(key, {
      inventoryItemId: source.inventoryItemId,
      ownerName: source.ownerName,
      ownerColor: source.ownerColor ?? undefined,
      setCode: source.setCode,
      collectorNumber: source.collectorNumber,
      foilStatus: source.foilStatus ?? undefined,
      condition: source.condition ?? undefined,
      language: source.language ?? undefined,
      availableQuantity: source.quantity,
      wishlistItemId: wishlistItem?.id,
      wishlistedQuantity: wishlistItem?.quantity,
    });
  }

  return Array.from(targets.values()).sort(
    (left, right) =>
      left.ownerName.localeCompare(right.ownerName) ||
      left.setCode.localeCompare(right.setCode) ||
      left.collectorNumber.localeCompare(right.collectorNumber, undefined, {
        numeric: true,
      }) ||
      (left.foilStatus ?? "").localeCompare(right.foilStatus ?? "") ||
      (left.condition ?? "").localeCompare(right.condition ?? "") ||
      (left.language ?? "").localeCompare(right.language ?? ""),
  );
}
