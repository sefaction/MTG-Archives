import type { Prisma, PrismaClient } from "@prisma/client";
import type { InventoryRow } from "../components/InventoryBrowser";
import { getPublicWishlistReferences, publicWishlistCategories, type PublicWishReference } from "./public-wishlist";
import { PUBLIC_WISHLIST_SORT_FIELDS, publicWishlistPrice } from "./public-wishlist-sort";
import { compareInventorySortValues, inventorySortValue } from "./inventory-sort";
import { formatSelectedPrice } from "./price-history";
import { getManaFacesForDto } from "./mtg/mana-display";

type Params = Record<string, string | string[] | undefined>;
const first = (params: Params, key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; };
const text = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const categoryLabel = (category: string) => publicWishlistCategories.find(row => row.value === category)?.label ?? category;
const wishKey = (wish: PublicWishReference) => JSON.stringify([wish.category, wish.name, wish.printing, wish.finish]);

export function publicWishlistBrowseParams(raw: Params, hidePricing = false) {
  const sort = first(raw, "sort");
  const pageSize = Number(first(raw, "pageSize"));
  const page = Number(first(raw, "page"));
  return {
    cardName: first(raw, "cardName").trim().slice(0, 120),
    category: first(raw, "category").slice(0, 20),
    sort: (PUBLIC_WISHLIST_SORT_FIELDS as readonly string[]).includes(sort) && !(hidePricing && sort === "preferredPriceLabel") ? sort : "cardName",
    sortDir: first(raw, "sortDir") === "desc" && !(hidePricing && sort === "preferredPriceLabel") ? "desc" as const : "asc" as const,
    pageSize: [10, 25, 50, 100, 250].includes(pageSize) ? pageSize : 25,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    browse: first(raw, "browse") === "infinite" ? "infinite" as const : "paginated" as const,
  };
}

// Only public catalog data. Wide artwork/rules fields are hydrated for the
// visible page; source notes, IDs, owners, decks and partners never enter DTOs.
const metadataSelect = { id: true, name: true, setCode: true, setName: true, collectorNumber: true, lang: true,
  rarity: true, manaCost: true, manaValue: true, typeLine: true, colorIdentity: true, releasedAt: true } as const;
const displaySelect = { ...metadataSelect, imageUri: true, imageUris: true, cardFaces: true, layout: true,
  oracleText: true, power: true, toughness: true, loyalty: true, defense: true, legalities: true,
  artist: true, scryfallUri: true } as const;
const chunks = <T,>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const fallbackKey = (row: { setCode: string; collectorNumber: string | null; name?: string }) =>
  JSON.stringify([row.setCode.toLowerCase(), row.collectorNumber?.toLowerCase() || "", row.name?.toLowerCase() || ""]);

async function catalogMetadata(db: PrismaClient, wishes: PublicWishReference[], includePrices: boolean) {
  const select = { ...metadataSelect, ...(includePrices ? { prices: true } : {}) } satisfies Prisma.CardSelect;
  const found: any[] = [];
  for (const ids of chunks([...new Set(wishes.flatMap(wish => wish.cardId ? [wish.cardId] : []))], 500))
    found.push(...await db.card.findMany({ where: { id: { in: ids } }, select }));
  const unresolved = [...new Map(wishes.filter(wish => !wish.cardId).map(wish => [fallbackKey(wish), wish])).values()];
  for (const group of chunks(unresolved, 200)) {
    const conditions = group.map(wish => ({ setCode: { equals: wish.setCode, mode: "insensitive" as const },
      name: { equals: wish.name, mode: "insensitive" as const },
      ...(wish.collectorNumber ? { collectorNumber: { equals: wish.collectorNumber, mode: "insensitive" as const } } : {}) }));
    found.push(...await db.card.findMany({ where: { AND: [{ OR: conditions }, { OR: [{ digital: false }, { digital: null }] }] }, select }));
  }
  const byId = new Map(found.map(card => [card.id, card]));
  const byPrinting = new Map<string, any>();
  // An unbound Set Completion wish gets a deterministic catalog illustration.
  for (const card of [...found].sort((a, b) => Number(b.lang === "en") - Number(a.lang === "en") || text.compare(a.id, b.id))) {
    for (const key of [fallbackKey(card), fallbackKey({ ...card, collectorNumber: null })])
      if (!byPrinting.has(key)) byPrinting.set(key, card);
  }
  return wishes.map(wish => ({ wish, card: (wish.cardId ? byId.get(wish.cardId) : byPrinting.get(fallbackKey(wish))) ?? {
    name: wish.name, setCode: wish.setCode, collectorNumber: wish.collectorNumber, rarity: "", typeLine: "",
  } }));
}

export async function getPublicWishlistBrowse(db: PrismaClient, username: string, raw: Params, provider?: string | null) {
  const view = await getPublicWishlistReferences(db, username);
  if (!view) return null;
  const params = publicWishlistBrowseParams(raw, view.hidePricing);
  const categoryCounts = Object.fromEntries(view.categories.map(category => [category, view.wishes.filter(wish => wish.category === category).length]));
  const wishes = view.wishes.filter(wish => !params.category || params.category === "all" || wish.category === params.category);
  const metadata = await catalogMetadata(db, wishes, !view.hidePricing && params.sort === "preferredPriceLabel");
  const query = params.cardName.toLocaleLowerCase();
  const filtered = metadata.filter(({ wish, card }) => !query || [wish.name, wish.printing, card.setName, card.typeLine].some(value => String(value ?? "").toLocaleLowerCase().includes(query)));
  const price = (row: typeof metadata[number]) => publicWishlistPrice(row.card.prices, row.wish.preferredFinish, provider);
  const sortValue = (row: typeof metadata[number]) => {
    if (params.sort === "cardName") return { kind: "string", value: row.wish.name };
    if (params.sort === "wishCategory") return { kind: "string", value: categoryLabel(row.wish.category) };
    if (params.sort === "printingPreference") return { kind: "string", value: row.wish.printing };
    if (params.sort === "foilStatus") return { kind: "string", value: row.wish.finish };
    if (params.sort === "preferredPriceLabel") { const quote = price(row).quote; return { kind: "number", value: quote?.amount ?? null, currency: quote?.currency, nullsLast: true }; }
    return inventorySortValue({ quantity: row.wish.quantity }, row.card, params.sort, provider);
  };
  filtered.sort((a, b) => compareInventorySortValues(sortValue(a), sortValue(b), params.sortDir) || text.compare(wishKey(a.wish), wishKey(b.wish)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / params.pageSize));
  const page = Math.min(params.page, totalPages), selected = filtered.slice((page - 1) * params.pageSize, page * params.pageSize);
  const ids = selected.flatMap(row => row.card.id ? [row.card.id] : []);
  const cards = ids.length ? await db.card.findMany({ where: { id: { in: ids } }, select: { ...displaySelect, ...(!view.hidePricing ? { prices: true } : {}) } }) : [];
  const hydrated = new Map(cards.map(card => [card.id, card]));
  const rows: InventoryRow[] = selected.map(row => {
    const card: any = hydrated.get(row.card.id) ?? row.card;
    const quoted = params.sort === "preferredPriceLabel" ? price(row) : publicWishlistPrice(card.prices, row.wish.preferredFinish, provider);
    const finish = row.wish.preferredFinish?.toUpperCase();
    return {
      id: `public-wish-${wishKey(row.wish)}`, cardId: card.id ?? "", cardName: row.wish.name, quantity: row.wish.quantity,
      currentOwnerId: "public-wishlist", currentOwner: view.username, setCode: row.wish.setCode.toUpperCase(),
      setName: card.setName ?? "", collectorNumber: row.wish.collectorNumber ?? card.collectorNumber ?? "", rarity: card.rarity ?? "",
      manaCost: card.manaCost ?? "", manaValue: card.manaValue ?? undefined, manaFaces: getManaFacesForDto(card),
      typeLine: card.typeLine ?? "", colorIdentity: Array.isArray(card.colorIdentity) ? card.colorIdentity.join(",") : "",
      releasedAt: card.releasedAt?.toISOString().slice(0, 10) ?? "", imageUri: card.imageUri ?? card.imageUris?.normal ?? card.imageUris?.large ?? undefined,
      imageSmall: card.imageUris?.small, cardFaces: Array.isArray(card.cardFaces) ? card.cardFaces : [], layout: card.layout ?? "",
      oracleText: card.oracleText ?? "", power: card.power ?? undefined, toughness: card.toughness ?? undefined,
      loyalty: card.loyalty ?? undefined, defense: card.defense ?? undefined, legalities: card.legalities ?? {},
      artist: card.artist ?? "", scryfallUri: card.scryfallUri ?? undefined, foil: finish === "FOIL",
      ...(finish === "NONFOIL" || finish === "FOIL" || finish === "ETCHED" ? { foilStatus: finish } : {}),
      ...(!view.hidePricing ? { preferredPriceLabel: `${quoted.from && quoted.quote ? "From " : ""}${formatSelectedPrice(quoted.quote)}` } : {}),
      displayMode: "exact", rollupPrinting: true,
      wishlist: { category: row.wish.category, categoryLabel: categoryLabel(row.wish.category), printing: row.wish.printing, finish: row.wish.finish },
    };
  });
  return { username: view.username, categories: view.categories, categoryCounts, showPricing: !view.hidePricing, params,
    rows, page, totalPages, hasNextPage: page < totalPages, totalMatchingCount: filtered.length,
    totalMatchingCards: filtered.reduce((sum, row) => sum + row.wish.quantity, 0) };
}
