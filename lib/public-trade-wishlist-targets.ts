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
};

export function buildPublicTradeWishlistTargets(
  sources: PublicTradeWishlistSource[],
  viewerPlayerId?: string | null,
): PublicTradeWishlistTarget[] {
  const targets = new Map<string, PublicTradeWishlistTarget>();

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
