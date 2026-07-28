import type { TradeBuilderItem } from "@/components/TradeBuilder";

export const TRADE_PAIRING_MIME = "application/x-mtg-trade-card";
export const TRADE_PAIRING_ADD_EVENT = "mtg:trade-pairing-add";

export type TradePairingSide = "offered" | "requested";

export type TradePairingPayload = {
  side: TradePairingSide;
  item: TradeBuilderItem;
};

export function tradePairingSideMime(side: TradePairingSide) {
  return `${TRADE_PAIRING_MIME}-${side}`;
}

export function encodeTradePairingPayload(payload: TradePairingPayload) {
  return JSON.stringify(payload);
}

export function parseTradePairingPayload(
  value: string,
): TradePairingPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<TradePairingPayload>;
    if (parsed.side !== "offered" && parsed.side !== "requested") return null;
    if (
      !parsed.item ||
      typeof parsed.item !== "object" ||
      typeof parsed.item.id !== "string" ||
      !parsed.item.id ||
      typeof parsed.item.cardName !== "string" ||
      !parsed.item.cardName
    ) {
      return null;
    }
    return parsed as TradePairingPayload;
  } catch {
    return null;
  }
}
