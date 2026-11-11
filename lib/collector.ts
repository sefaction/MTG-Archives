import { z } from "zod";

export const collectorCardSchema = z.object({
  id: z.string().min(1), oracle_id: z.string().min(1).optional(), name: z.string().min(1),
  set: z.string().regex(/^[a-z0-9]{2,8}$/), lang: z.string(), digital: z.boolean(),
  games: z.array(z.string()), layout: z.string(), type_line: z.string().optional(),
  card_faces: z.array(z.object({type_line: z.string().optional()})).optional(),
  oversized: z.boolean(), finishes: z.array(z.enum(["nonfoil", "foil", "etched"])).min(1),
  collector_number: z.string().optional(),
});
export type CollectorCard = z.infer<typeof collectorCardSchema>;
export type CollectorOwned = { currentOwnerId: string; quantity: number; language: string;
  foilStatus: string; card: { scryfallId: string } };
export type CollectorCounts = { owned: number; total: number; percent: number };
export type CollectorProgress = { grouped: CollectorCounts; variants: CollectorCounts };
export type CollectorMode = keyof CollectorProgress;
export const collectorFinishLabels: Record<CollectorCard["finishes"][number], string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};
export type CollectorDetailRow = {
  id: string;
  name: string;
  quantity: number;
  collectorNumber?: string;
  finish?: CollectorCard["finishes"][number];
};
export type CollectorDetail = {
  rows: CollectorDetailRow[];
  progress: CollectorCounts;
  page: number;
  pages: number;
  matches: number;
};

export function eligibleCollectorCard(card: CollectorCard) {
  return card.lang === "en" && !card.digital && card.games.includes("paper") && !card.oversized &&
    !["token", "double_faced_token", "emblem", "art_series"].includes(card.layout) &&
    ![card.type_line, ...(card.card_faces ?? []).map(face => face.type_line)].some(type => /\b(Token|Emblem|Card)\b/.test(type ?? ""));
}
const groupKey = (card: CollectorCard) => card.oracle_id ?? `name:${card.name}`;
function collectorTally(cards: CollectorCard[], owned: CollectorOwned[], ownerId: string) {
  const eligible = new Map(cards.filter(eligibleCollectorCard).map(card => [card.id, card]));
  const groups = new Map<string, CollectorDetailRow>();
  const variants = new Map<string, CollectorDetailRow>();
  for (const card of eligible.values()) {
    const group = groupKey(card);
    if (!groups.has(group)) groups.set(group, {id: group, name: card.name, quantity: 0});
    for (const finish of card.finishes) {
      const id = `${card.id}:${finish}`;
      variants.set(id, {id, name: card.name, quantity: 0, collectorNumber: card.collector_number, finish});
    }
  }
  for (const item of owned) {
    if (item.currentOwnerId !== ownerId || item.quantity <= 0 || item.language.toLowerCase() !== "en") continue;
    const card = eligible.get(item.card.scryfallId);
    if (!card) continue;
    const variant = variants.get(`${card.id}:${item.foilStatus.toLowerCase()}`);
    if (!variant) continue;
    variant.quantity += item.quantity;
    const group = groups.get(groupKey(card))!;
    group.quantity += item.quantity;
  }
  return {grouped: groups, variants};
}

function count(rows: Map<string, CollectorDetailRow>): CollectorCounts {
  let owned = 0;
  for (const row of rows.values()) {
    if (row.quantity > 0) owned++;
  }
  return {owned, total: rows.size, percent: rows.size ? Math.floor(owned / rows.size * 1000) / 10 : 0};
}

export function collectorProgress(cards: CollectorCard[], owned: CollectorOwned[], ownerId: string): CollectorProgress {
  const {grouped, variants} = collectorTally(cards, owned, ownerId);
  return {grouped: count(grouped), variants: count(variants)};
}

const preferredFinishes = ["nonfoil", "foil", "etched"] as const;

export function collectorWishlistTargets(
  cards: CollectorCard[],
  owned: CollectorOwned[],
  ownerId: string,
  mode: CollectorMode,
) {
  const rows = collectorTally(cards, owned, ownerId)[mode];
  const groupedFinishes = new Map<string, CollectorCard["finishes"][number]>();
  if (mode === "grouped") {
    for (const card of cards.filter(eligibleCollectorCard)) {
      const key = groupKey(card);
      const current = groupedFinishes.get(key);
      const preferred = preferredFinishes.find(finish => card.finishes.includes(finish))!;
      if (!current || preferredFinishes.indexOf(preferred) < preferredFinishes.indexOf(current)) {
        groupedFinishes.set(key, preferred);
      }
    }
  }
  return Array.from(rows.values(), row => ({
    ...row,
    preferredFinish: row.finish ?? groupedFinishes.get(row.id)!,
  }));
}

const PAGE_SIZE = 50;
const byCardName = new Intl.Collator("en", {numeric: true});
export function collectorDetail(cards: CollectorCard[], owned: CollectorOwned[], ownerId: string,
  {mode, page, missingOnly}: {mode: CollectorMode; page: number; missingOnly: boolean}): CollectorDetail {
  const targets = collectorTally(cards, owned, ownerId)[mode];
  const rows = Array.from(targets.values()).filter(row => !missingOnly || row.quantity === 0);
  rows.sort((a, b) => byCardName.compare(a.name, b.name) ||
    byCardName.compare(a.collectorNumber ?? "", b.collectorNumber ?? "") ||
    byCardName.compare(a.id, b.id));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return {rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    progress: count(targets), page: current, pages, matches: rows.length};
}
