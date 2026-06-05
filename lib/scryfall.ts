export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_identity: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
  type_line: string;
  oracle_text?: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  artist?: string;
  image_uris?: { normal?: string; small?: string };
  card_faces?: { image_uris?: { normal?: string; small?: string } }[];
  prices?: Record<string, string | null>;
  purchase_uris?: Record<string, string>;
  scryfall_uri?: string;
};

async function readCardResponse(res: Response): Promise<ScryfallCard | null> {
  if (!res.ok) return null;
  return await res.json();
}

export async function searchCards(q: string): Promise<ScryfallCard[]> {
  if (!q || q.trim().length < 2) return [];
  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&unique=prints`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data ?? [];
}

export async function getCardByScryfallId(
  id: string,
): Promise<ScryfallCard | null> {
  const res = await fetch(`https://api.scryfall.com/cards/${id}`, {
    cache: "no-store",
  });
  return readCardResponse(res);
}

export async function getCardBySetAndCollector(
  setCode: string,
  collectorNumber: string,
): Promise<ScryfallCard | null> {
  if (!setCode || !collectorNumber) return null;
  const res = await fetch(
    `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber.trim())}`,
    { cache: "no-store" },
  );
  return readCardResponse(res);
}

export async function getFuzzyCard(name: string): Promise<ScryfallCard | null> {
  if (!name || name.trim().length < 2) return null;
  const res = await fetch(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.trim())}`,
    { cache: "no-store" },
  );
  return readCardResponse(res);
}
