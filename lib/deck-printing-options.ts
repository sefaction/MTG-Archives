import type { DeckCardSearchResult } from "./deck-search";

function normalizedCardName(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterExactCardPrintings(
  results: DeckCardSearchResult[],
  cardName: string,
  setCode = "",
) {
  const expectedName = normalizedCardName(cardName);
  const expectedSet = setCode.trim().toLocaleLowerCase();
  return results.filter(
    (result) =>
      normalizedCardName(result.name) === expectedName &&
      (!expectedSet || result.setCode.toLocaleLowerCase() === expectedSet),
  );
}

export function getPrintingSetOptions(
  results: DeckCardSearchResult[],
  cardName: string,
) {
  const sets = new Map<string, { code: string; name: string }>();
  for (const result of filterExactCardPrintings(results, cardName)) {
    const code = result.setCode.toLocaleLowerCase();
    if (!sets.has(code)) {
      sets.set(code, {
        code,
        name: result.setName?.trim() || result.setCode.toUpperCase(),
      });
    }
  }
  return [...sets.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
  );
}
