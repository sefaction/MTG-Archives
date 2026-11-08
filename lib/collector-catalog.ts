import { z } from "zod";
import { collectorCardSchema, type CollectorCard } from "./collector";
import { getCollectorSetsResult, getCollectorSetPageResult } from "./scryfall";

export const setSchema = z.object({code: z.string().regex(/^[a-z0-9]{2,8}$/), name: z.string(),
  set_type: z.string(), digital: z.boolean(), released_at: z.string().optional()});
export type CollectorSet = z.infer<typeof setSchema>;
const pageSchema = z.object({object: z.literal("list"), total_cards: z.number().int().positive().max(20000),
  has_more: z.boolean(), data: z.array(collectorCardSchema).min(1).max(200)});
export type CollectorCatalog = {cards: CollectorCard[]; checkedAt: string};
const ttl = 24 * 60 * 60 * 1000;
let setsCache: {expires: number; value: CollectorSet[]} | undefined;

export function eligibleCollectorSets(sets: CollectorSet[]) {
  return sets.filter(set => !set.digital && !["token", "minigame", "alchemy"].includes(set.set_type));
}
export async function collectorSets(): Promise<CollectorSet[]> {
  if (setsCache && setsCache.expires > Date.now()) return setsCache.value;
  const result = await getCollectorSetsResult(AbortSignal.timeout(30000));
  if (!result.ok) throw Error("Set directory unavailable");
  const data = z.object({object: z.literal("list"), has_more: z.literal(false).optional(),
    data: z.array(setSchema).max(5000)}).parse(result.data);
  const value = eligibleCollectorSets(data.data);
  if (new Set(value.map(set => set.code)).size !== value.length) throw Error("Repeated set identity");
  setsCache = {expires: Date.now() + ttl, value};
  return value;
}

// Complete enumeration is a prerequisite, not a confidence heuristic. No local
// Card rows or partial provider results can become a full-set denominator.
export async function fetchCollectorCatalog(set: string,
  provider = getCollectorSetPageResult, signal = AbortSignal.timeout(60000)): Promise<CollectorCatalog> {
  if (!/^[a-z0-9]{2,8}$/.test(set)) throw Error("Invalid set code");
  const cards = new Map<string, CollectorCard>();
  let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted();
    const result = await provider(set, page, signal);
    if (!result.ok) throw Error("Set catalog unavailable");
    const data = pageSchema.parse(result.data);
    if (total !== undefined && total !== data.total_cards) throw Error("Catalog changed during enumeration");
    total = data.total_cards;
    for (const card of data.data) {
      if (card.set !== set || card.lang !== "en" || card.digital || !card.games.includes("paper") || cards.has(card.id))
        throw Error("Unexpected or repeated catalog printing");
      cards.set(card.id, card);
    }
    if (cards.size > total) throw Error("Catalog count exceeded");
    if (!data.has_more) {
      if (cards.size !== total) throw Error("Incomplete catalog enumeration");
      return {cards: [...cards.values()], checkedAt: new Date().toISOString()};
    }
  }
  throw Error("Catalog page bound reached");
}
// Queued, subscriber-aware work: navigation releases its subscription. The last
// departing caller cancels both a queued lookup and an active provider fetch.
export function createCollectorCatalogLoader(load = fetchCollectorCatalog) {
  const cache = new Map<string, {expires: number; value: CollectorCatalog}>();
  type Entry = {promise: Promise<CollectorCatalog>; controller: AbortController; subscribers: number};
  const pending = new Map<string, Entry>();
  let active = 0;
  const queue: Array<{start: () => void; cancel: () => void}> = [];
  const acquire = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (active < 3) { active++; return Promise.resolve(); }
    if (queue.length >= 24) return Promise.reject(Error("Catalog queue busy"));
    return new Promise<void>((resolve, reject) => {
      const entry = {start: () => {signal.removeEventListener("abort", entry.cancel); resolve();},
        cancel: () => {const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1); reject(signal.reason);}};
      queue.push(entry); signal.addEventListener("abort", entry.cancel, {once: true});
    });
  };
  const release = () => {const next = queue.shift(); if (next) next.start(); else active--;};
  return async (set: string, signal?: AbortSignal): Promise<CollectorCatalog> => {
    signal?.throwIfAborted();
    const cached = cache.get(set);
    if (cached && cached.expires > Date.now()) return cached.value;
    let entry = pending.get(set);
    if (entry?.controller.signal.aborted) entry = undefined;
    if (!entry) {
      const controller = new AbortController();
      const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
      const created: Entry = {controller, subscribers: 0, promise: Promise.resolve(null as never)};
      created.promise = (async () => {
        await acquire(combined);
        try {
          const value = await load(set, undefined, combined);
          while (cache.size >= 64 || [...cache.values()].reduce((n, row) => n + row.value.cards.length, 0) + value.cards.length > 30000) {
            const oldest = cache.keys().next().value; if (!oldest) break; cache.delete(oldest);
          }
          cache.set(set, {expires: Date.now() + ttl, value});
          return value;
        } finally {release();}
      })().finally(() => {if (pending.get(set) === created) pending.delete(set);});
      pending.set(set, created); entry = created;
    }
    const subscribed = entry;
    subscribed.subscribers++;
    return new Promise<CollectorCatalog>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false; done = true;
        signal?.removeEventListener("abort", cancel);
        if (--subscribed.subscribers === 0) subscribed.controller.abort();
        return true;
      };
      const cancel = () => {if (finish()) reject(signal?.reason ?? Error("Cancelled"));};
      signal?.addEventListener("abort", cancel, {once: true});
      subscribed.promise.then(value => {if (finish()) resolve(value);}, error => {if (finish()) reject(error);});
      if (signal?.aborted) cancel();
    });
  };
}
export const collectorCatalog = createCollectorCatalogLoader();
