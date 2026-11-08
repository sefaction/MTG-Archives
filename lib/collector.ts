import { z } from "zod";

export const collectorCardSchema = z.object({
  id: z.string().min(1), oracle_id: z.string().min(1).optional(), name: z.string().min(1),
  set: z.string().regex(/^[a-z0-9]{2,8}$/), lang: z.string(), digital: z.boolean(),
  games: z.array(z.string()), layout: z.string(), type_line: z.string().optional(),
  card_faces: z.array(z.object({type_line: z.string().optional()})).optional(),
  oversized: z.boolean(), finishes: z.array(z.enum(["nonfoil", "foil", "etched"])).min(1),
});
export type CollectorCard = z.infer<typeof collectorCardSchema>;
export type CollectorOwned = { currentOwnerId: string; quantity: number; language: string;
  foilStatus: string; card: { scryfallId: string } };
export type CollectorCounts = { owned: number; total: number; percent: number };
export type CollectorProgress = { grouped: CollectorCounts; variants: CollectorCounts };

export function eligibleCollectorCard(card: CollectorCard) {
  return card.lang === "en" && !card.digital && card.games.includes("paper") && !card.oversized &&
    !["token", "double_faced_token", "emblem", "art_series"].includes(card.layout) &&
    ![card.type_line, ...(card.card_faces ?? []).map(face => face.type_line)].some(type => /\b(Token|Emblem|Card)\b/.test(type ?? ""));
}
const groupKey = (card: CollectorCard) => card.oracle_id ?? `name:${card.name}`;
export function collectorProgress(cards: CollectorCard[], owned: CollectorOwned[], ownerId: string): CollectorProgress {
  const eligible = new Map(cards.filter(eligibleCollectorCard).map(card => [card.id, card]));
  const groups = new Set<string>(), variants = new Set<string>();
  const ownedGroups = new Set<string>(), ownedVariants = new Set<string>();
  for (const card of eligible.values()) {
    groups.add(groupKey(card));
    for (const finish of card.finishes) variants.add(`${card.id}:${finish}`);
  }
  for (const item of owned) {
    if (item.currentOwnerId !== ownerId || item.quantity <= 0 || item.language.toLowerCase() !== "en") continue;
    const card = eligible.get(item.card.scryfallId);
    if (!card) continue;
    const variant = `${card.id}:${item.foilStatus.toLowerCase()}`;
    if (!variants.has(variant)) continue;
    ownedGroups.add(groupKey(card)); ownedVariants.add(variant);
  }
  const count = (have: number, total: number): CollectorCounts => ({owned: have, total,
    percent: total ? Math.floor(have / total * 1000) / 10 : 0});
  return {grouped: count(ownedGroups.size, groups.size), variants: count(ownedVariants.size, variants.size)};
}
