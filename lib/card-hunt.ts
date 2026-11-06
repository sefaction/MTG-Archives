export type HuntFinish = "ANY" | "NONFOIL" | "FOIL" | "ETCHED";
export type HuntMode = "preferences" | "boxes";

export type HuntRequest = {
  id: string;
  name: string;
  quantity: number;
  cardId?: string | null;
  oracleId?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  finish?: HuntFinish;
  alreadyInDeck?: number;
};

export type HuntStock = {
  id: string;
  ownerId: string;
  quantity: number;
  reserved: number;
  cardId: string;
  oracleId: string | null;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  language: string;
  condition: string;
  location: {
    id: string;
    name: string;
    section: string | null;
    ownerId: string;
    active: boolean;
    isDeck: boolean;
  } | null;
};

export type HuntPick = {
  requestId: string;
  inventoryItemId: string;
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  language: string;
  condition: string;
  section: string | null;
  alternatePrinting: boolean;
  finishCompromise: boolean;
};

export type HuntPlan = {
  mode: HuntMode;
  finish: HuntFinish;
  boxes: Array<{ id: string; name: string; picks: HuntPick[] }>;
  lines: Array<{
    request: HuntRequest;
    needed: number;
    planned: number;
    shortage: number;
    alternatives: Array<{
      cardId: string; setCode: string; collectorNumber: string;
      finish: string; available: number;
    }>;
    alternativeCount: number;
  }>;
  requested: number;
  alreadyInDeck: number;
  planned: number;
  shortage: number;
};

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function huntMatches(request: HuntRequest, stock: HuntStock) {
  if (request.cardId === stock.cardId) return true;
  if (request.oracleId) return request.oracleId === stock.oracleId;
  return nameKey(request.name) === nameKey(stock.name);
}

export function huntPrintingMatches(request: HuntRequest, stock: HuntStock) {
  if (request.cardId) return request.cardId === stock.cardId;
  return (!request.setCode || request.setCode.toLowerCase() === stock.setCode.toLowerCase()) &&
    (!request.collectorNumber || request.collectorNumber.toLowerCase() === stock.collectorNumber.toLowerCase());
}

export function isPullableHuntStock(stock: HuntStock, ownerId: string) {
  return stock.ownerId === ownerId && stock.quantity > 0 &&
    (!stock.location || (stock.location.ownerId === ownerId && stock.location.active && !stock.location.isDeck));
}

// This function plans quantities only. It never reserves, moves or edits copies.
export function planCardHunt(input: {
  ownerId: string; requests: HuntRequest[]; stock: HuntStock[];
  mode: HuntMode; finish: HuntFinish;
}): HuntPlan {
  const ids = new Set<string>();
  for (const request of input.requests) {
    if (!request.id || ids.has(request.id) || !request.name.trim() ||
      !Number.isSafeInteger(request.quantity) || request.quantity < 1 ||
      !Number.isSafeInteger(request.alreadyInDeck ?? 0) || (request.alreadyInDeck ?? 0) < 0)
      throw new Error("Every requested card needs a unique identity and positive whole quantity.");
    ids.add(request.id);
  }
  const stockIds = new Set<string>();
  const stock = input.stock.filter(item => {
    if (stockIds.has(item.id)) throw new Error("Duplicate storage identity.");
    stockIds.add(item.id);
    if (!Number.isSafeInteger(item.quantity) || !Number.isSafeInteger(item.reserved) || item.reserved < 0)
      throw new Error("Invalid storage quantities.");
    return isPullableHuntStock(item, input.ownerId) && item.quantity > item.reserved;
  }).sort((a, b) => compare(a.id, b.id));
  const remaining = new Map(stock.map(item => [item.id, item.quantity - item.reserved]));
  const lines = input.requests.map(request => {
    const candidates = stock.filter(item => huntMatches(request, item));
    const alternatives = new Map<string, HuntPlan["lines"][number]["alternatives"][number]>();
    for (const item of candidates) {
      if (huntPrintingMatches(request, item)) continue;
      const key = `${item.cardId}:${item.finish}`;
      const prior = alternatives.get(key);
      if (prior) prior.available += remaining.get(item.id)!;
      else alternatives.set(key, {cardId: item.cardId, setCode: item.setCode,
        collectorNumber: item.collectorNumber, finish: item.finish, available: remaining.get(item.id)!});
    }
    const needed = Math.max(0, request.quantity - (request.alreadyInDeck ?? 0));
    return { request, candidates, needed, planned: 0, shortage: needed,
      alternatives: [...alternatives.values()].slice(0, 6), alternativeCount: alternatives.size };
  });
  const boxes = new Map<string, HuntPlan["boxes"][number]>();
  const boxId = (item: HuntStock) => item.location?.id ?? "unassigned";
  const rank = (line: typeof lines[number], item: HuntStock) => {
    const finish = line.request.finish && line.request.finish !== "ANY" ? line.request.finish : input.finish;
    // An explicit finish preference wins, followed by the requested printing.
    return (finish !== "ANY" && finish !== item.finish ? 2 : 0) +
      (huntPrintingMatches(line.request, item) ? 0 : 1);
  };
  while (lines.some(line => line.shortage > 0)) {
    const eligible = lines.filter(line => line.shortage > 0).map(line => {
      const available = line.candidates.filter(item => remaining.get(item.id)! > 0);
      const bestRank = available.reduce((best, item) => Math.min(best, rank(line, item)), Infinity);
      return { line, items: input.mode === "preferences" ? available.filter(item => rank(line, item) === bestRank) : available };
    }).filter(entry => entry.items.length);
    if (!eligible.length) break;
    const locations = [...new Set(eligible.flatMap(entry => entry.items.map(boxId)))];
    type Move = {line: typeof lines[number]; item: HuntStock; quantity: number};
    let best: {id: string; moves: Move[]; count: number; penalty: number} | null = null;
    for (const id of locations) {
      const simulated = new Map<string, number>();
      const moves: Move[] = [];
      let count = 0, penalty = 0;
      // Constrained lines first; a shared stack can never satisfy two lines twice.
      for (const {line, items} of [...eligible].sort((a, b) => a.items.length - b.items.length || compare(a.line.request.id, b.line.request.id))) {
        let needed = line.shortage;
        for (const item of items.filter(item => boxId(item) === id).sort((a, b) => rank(line, a) - rank(line, b) || compare(a.id, b.id))) {
          const available = simulated.get(item.id) ?? remaining.get(item.id)!;
          const quantity = Math.min(needed, available);
          if (!quantity) continue;
          simulated.set(item.id, available - quantity);
          moves.push({line, item, quantity});
          count += quantity; penalty += quantity * rank(line, item); needed -= quantity;
          if (!needed) break;
        }
      }
      const reuse = boxes.has(id) ? 1 : 0;
      const bestReuse = best && boxes.has(best.id) ? 1 : 0;
      if (count && (!best || reuse > bestReuse || (reuse === bestReuse &&
        (count > best.count || (count === best.count && (penalty < best.penalty ||
          (penalty === best.penalty && compare(id, best.id) < 0))))))) best = {id, moves, count, penalty};
    }
    if (!best) break;
    const box = boxes.get(best.id) ?? {id: best.id, name: best.moves[0].item.location?.name ?? "Unassigned location", picks: []};
    boxes.set(best.id, box);
    for (const {line, item, quantity} of best.moves) {
      remaining.set(item.id, remaining.get(item.id)! - quantity);
      line.planned += quantity; line.shortage -= quantity;
      const previous = box.picks.find(p => p.requestId === line.request.id && p.inventoryItemId === item.id);
      if (previous) previous.quantity += quantity;
      else box.picks.push({requestId: line.request.id, inventoryItemId: item.id, quantity,
        name: line.request.name, setCode: item.setCode, collectorNumber: item.collectorNumber,
        finish: item.finish, language: item.language, condition: item.condition, section: item.location?.section ?? null,
        alternatePrinting: !huntPrintingMatches(line.request, item), finishCompromise: rank(line, item) >= 2});
    }
  }
  return {mode: input.mode, finish: input.finish,
    boxes: [...boxes.values()].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id)).map(box => ({...box,
      picks: box.picks.sort((a, b) => compare(a.section ?? "", b.section ?? "") || compare(a.name, b.name) || compare(a.inventoryItemId, b.inventoryItemId))})),
    lines: lines.map(({candidates: _candidates, ...line}) => line),
    requested: lines.reduce((sum, line) => sum + line.request.quantity, 0),
    alreadyInDeck: lines.reduce((sum, line) => sum + Math.min(line.request.quantity, line.request.alreadyInDeck ?? 0), 0),
    planned: lines.reduce((sum, line) => sum + line.planned, 0),
    shortage: lines.reduce((sum, line) => sum + line.shortage, 0)};
}
