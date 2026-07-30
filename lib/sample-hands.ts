import { DeckSection } from "@prisma/client";
import type { DeckSnapshotEntry } from "./deck-snapshot";

export type SimulatedDeckCard = {
  instanceId: string;
  copyNumber: number;
  entry: DeckSnapshotEntry;
};

export type SampleHandState = {
  seed: string;
  library: SimulatedDeckCard[];
  hand: SimulatedDeckCard[];
  commandZone: SimulatedDeckCard[];
  mulliganCount: number;
  kept: boolean;
  bottomedInstanceIds: string[];
};

export type HandColor = "W" | "U" | "B" | "R" | "G" | "C";

export type SampleHandSummary = {
  handSize: number;
  landCapable: number;
  castableSpells: number;
  averageSpellManaValue: number | null;
  colorCounts: Record<HandColor, number>;
  expectedLandsInOpeningHand: number;
  librarySize: number;
  landCapableInLibrary: number;
};

const OPENING_HAND_SIZE = 7;

function normalizedQuantity(entry: DeckSnapshotEntry) {
  return Math.max(0, Math.floor(entry.quantity));
}

function instance(entry: DeckSnapshotEntry, copyNumber: number) {
  return {
    instanceId: `${entry.id}:${copyNumber}`,
    copyNumber,
    entry,
  };
}

export function expandSampleHandDeck(entries: DeckSnapshotEntry[]) {
  const library: SimulatedDeckCard[] = [];
  const commandZone: SimulatedDeckCard[] = [];

  for (const entry of entries) {
    const isCommander =
      entry.section === DeckSection.COMMANDER || entry.isCommander;
    if (!isCommander && entry.section !== DeckSection.MAINBOARD) continue;

    for (
      let copyNumber = 1;
      copyNumber <= normalizedQuantity(entry);
      copyNumber += 1
    ) {
      (isCommander ? commandZone : library).push(instance(entry, copyNumber));
    }
  }

  return { library, commandZone };
}

export function seedToUint32(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string) {
  let value = seedToUint32(seed);
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSampleHandLibrary(
  cards: SimulatedDeckCard[],
  seed: string,
) {
  const shuffled = cards.slice();
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

function drawFromLibrary(cards: SimulatedDeckCard[], quantity: number) {
  const drawCount = Math.min(Math.max(0, quantity), cards.length);
  return {
    drawn: cards.slice(0, drawCount),
    library: cards.slice(drawCount),
  };
}

export function createSampleHandState(
  entries: DeckSnapshotEntry[],
  seed: string,
): SampleHandState {
  const expanded = expandSampleHandDeck(entries);
  const shuffled = shuffleSampleHandLibrary(expanded.library, seed);
  const opening = drawFromLibrary(shuffled, OPENING_HAND_SIZE);
  return {
    seed,
    library: opening.library,
    hand: opening.drawn,
    commandZone: expanded.commandZone,
    mulliganCount: 0,
    kept: false,
    bottomedInstanceIds: [],
  };
}

export function mulliganSampleHand(state: SampleHandState): SampleHandState {
  if (state.kept) return state;
  const mulliganCount = state.mulliganCount + 1;
  const completeLibrary = [...state.hand, ...state.library];
  const shuffled = shuffleSampleHandLibrary(
    completeLibrary,
    `${state.seed}:mulligan:${mulliganCount}`,
  );
  const opening = drawFromLibrary(shuffled, OPENING_HAND_SIZE);
  return {
    ...state,
    library: opening.library,
    hand: opening.drawn,
    mulliganCount,
    bottomedInstanceIds: [],
  };
}

export function requiredMulliganBottomCount(state: SampleHandState) {
  return Math.min(state.mulliganCount, state.hand.length);
}

export function keepSampleHand(
  state: SampleHandState,
  selectedInstanceIds: Iterable<string>,
): SampleHandState {
  if (state.kept) return state;

  const selected = new Set(selectedInstanceIds);
  const required = requiredMulliganBottomCount(state);
  if (selected.size !== required) {
    throw new Error(
      `Choose exactly ${required} ${required === 1 ? "card" : "cards"} to put on the bottom.`,
    );
  }
  const handIds = new Set(state.hand.map((card) => card.instanceId));
  if ([...selected].some((id) => !handIds.has(id))) {
    throw new Error("Only cards in the current hand can be put on the bottom.");
  }

  const bottomed = state.hand.filter((card) => selected.has(card.instanceId));
  return {
    ...state,
    hand: state.hand.filter((card) => !selected.has(card.instanceId)),
    library: [...state.library, ...bottomed],
    kept: true,
    bottomedInstanceIds: bottomed.map((card) => card.instanceId),
  };
}

export function drawSampleHandCard(state: SampleHandState): SampleHandState {
  if (!state.kept || state.library.length === 0) return state;
  const draw = drawFromLibrary(state.library, 1);
  return {
    ...state,
    library: draw.library,
    hand: [...state.hand, ...draw.drawn],
  };
}

function faceTypeLines(entry: DeckSnapshotEntry) {
  const faces = entry.card?.cardFaces ?? [];
  if (faces.length) return faces.map((face) => face.typeLine);
  return (entry.card?.typeLine ?? "")
    .split(/\s*\/\/\s*/)
    .map((typeLine) => typeLine.trim())
    .filter(Boolean);
}

function typeLineIsLand(typeLine: string) {
  return /\bLand\b/i.test(typeLine);
}

export function isLandCapableSampleCard(card: SimulatedDeckCard) {
  return faceTypeLines(card.entry).some(typeLineIsLand);
}

export function isCastableSampleSpell(card: SimulatedDeckCard) {
  return faceTypeLines(card.entry).some(
    (typeLine) => !typeLineIsLand(typeLine),
  );
}

function spellManaValue(card: SimulatedDeckCard) {
  if (!isCastableSampleSpell(card)) return null;
  const manaValue = card.entry.card?.manaValue;
  return typeof manaValue === "number" && Number.isFinite(manaValue)
    ? manaValue
    : null;
}

function cardColors(card: SimulatedDeckCard): HandColor[] {
  const colors = (card.entry.card?.colors ?? []).filter(
    (color): color is Exclude<HandColor, "C"> =>
      ["W", "U", "B", "R", "G"].includes(color),
  );
  return colors.length ? [...new Set(colors)] : ["C"];
}

export function summarizeSampleHand(state: SampleHandState): SampleHandSummary {
  const completeLibrary = [...state.hand, ...state.library];
  const landCapableInLibrary = completeLibrary.filter(
    isLandCapableSampleCard,
  ).length;
  const spellManaValues = state.hand
    .map(spellManaValue)
    .filter((value): value is number => value != null);
  const colorCounts: Record<HandColor, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
  };
  for (const card of state.hand) {
    for (const color of cardColors(card)) colorCounts[color] += 1;
  }

  const openingSize = Math.min(OPENING_HAND_SIZE, completeLibrary.length);
  return {
    handSize: state.hand.length,
    landCapable: state.hand.filter(isLandCapableSampleCard).length,
    castableSpells: state.hand.filter(isCastableSampleSpell).length,
    averageSpellManaValue: spellManaValues.length
      ? spellManaValues.reduce((total, value) => total + value, 0) /
        spellManaValues.length
      : null,
    colorCounts,
    expectedLandsInOpeningHand: completeLibrary.length
      ? (openingSize * landCapableInLibrary) / completeLibrary.length
      : 0,
    librarySize: completeLibrary.length,
    landCapableInLibrary,
  };
}
