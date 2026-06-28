export const DECK_BRACKETS = [1, 2, 3, 4, 5] as const;

export type DeckBracket = (typeof DECK_BRACKETS)[number];

export const deckBracketLabels: Record<DeckBracket, string> = {
  1: "Bracket 1",
  2: "Bracket 2",
  3: "Bracket 3",
  4: "Bracket 4",
  5: "Bracket 5",
};

export function parseDeckBracket(value: FormDataEntryValue | string | null) {
  const parsed = Number(value);
  return DECK_BRACKETS.includes(parsed as DeckBracket)
    ? (parsed as DeckBracket)
    : null;
}

export function formatDeckBracket(value?: number | null) {
  return value && DECK_BRACKETS.includes(value as DeckBracket)
    ? deckBracketLabels[value as DeckBracket]
    : "Bracket unset";
}

export function bracketSelectOptions() {
  return [
    { value: "", label: "Unset" },
    ...DECK_BRACKETS.map((bracket) => ({
      value: String(bracket),
      label: deckBracketLabels[bracket],
    })),
  ];
}
