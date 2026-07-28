export type TradeLineSelection = {
  inventoryItemId: string;
  quantity: number;
};

export type TradeReservationLine = {
  inventoryItemId: string | null;
  quantity: number;
};

export type LegacyTradeReservation = {
  offeredInventoryItemId: string | null;
  requestedInventoryItemId: string | null;
};

const MAX_TRADE_LINES_PER_SIDE = 50;
const MAX_TRADE_LINE_QUANTITY = 999;

export function normalizeTradeLineSelections(
  selections: TradeLineSelection[],
): TradeLineSelection[] {
  const quantities = new Map<string, number>();

  for (const selection of selections) {
    const inventoryItemId = String(selection.inventoryItemId || "").trim();
    const quantity = Number(selection.quantity);
    if (!inventoryItemId) throw new Error("Every trade line needs a card.");
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_TRADE_LINE_QUANTITY
    ) {
      throw new Error("Trade line quantities must be whole numbers.");
    }
    quantities.set(
      inventoryItemId,
      (quantities.get(inventoryItemId) ?? 0) + quantity,
    );
  }

  if (quantities.size > MAX_TRADE_LINES_PER_SIDE) {
    throw new Error("A trade can contain at most 50 card lines per side.");
  }

  return Array.from(quantities, ([inventoryItemId, quantity]) => ({
    inventoryItemId,
    quantity,
  }));
}

export function parseTradeLineSelections(
  value: FormDataEntryValue | null,
  legacyInventoryItemId?: string,
): TradeLineSelection[] {
  if (!value) {
    return legacyInventoryItemId
      ? [{ inventoryItemId: legacyInventoryItemId, quantity: 1 }]
      : [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error("Trade card selections are invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Trade card selections are invalid.");
  }

  return normalizeTradeLineSelections(
    parsed.map((line) => {
      const record =
        line && typeof line === "object"
          ? (line as Record<string, unknown>)
          : {};
      return {
        inventoryItemId: String(record.inventoryItemId ?? record.id ?? ""),
        quantity: Number(record.quantity ?? 1),
      };
    }),
  );
}

export function buildReservedInventoryQuantities(
  lines: TradeReservationLine[],
  legacyTrades: LegacyTradeReservation[] = [],
): Map<string, number> {
  const reserved = new Map<string, number>();
  const add = (inventoryItemId: string | null, quantity: number) => {
    if (!inventoryItemId) return;
    reserved.set(
      inventoryItemId,
      (reserved.get(inventoryItemId) ?? 0) + quantity,
    );
  };

  for (const line of lines) add(line.inventoryItemId, line.quantity);
  for (const trade of legacyTrades) {
    add(trade.offeredInventoryItemId, 1);
    add(trade.requestedInventoryItemId, 1);
  }
  return reserved;
}
