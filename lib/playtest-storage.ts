import { z } from "zod";
import { DeckSection } from "@prisma/client";
import type { DeckSnapshotEntry } from "./deck-snapshot";
import {
  expandPlaytestDeck,
  MAX_PLAYTEST_CARDS,
  PLAYTEST_ZONES,
  type PlaytestCard,
  type PlaytestGameState,
} from "./playtest";

export const PLAYTEST_FILE_LIMIT = 1_000_000;
const integer = z.number().int().min(-99999).max(99999);
const count = z.number().int().min(0).max(9999);
const safeName = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !Object.hasOwn(Object.prototype, value) && value !== "prototype",
    );
const counters = (max: number, length: number) =>
  z
    .record(safeName(length), count)
    .refine((value) => Object.keys(value).length <= max);
const cardSchema = z
  .object({
    instanceId: z.string().min(1).max(200),
    entryId: z.string().min(1).max(200).nullable(),
    tokenName: z.string().min(1).max(120).nullable(),
    origin: z.enum(["deck", "token", "copy"]),
    tapped: z.boolean(),
    faceIndex: z.union([z.literal(0), z.literal(1)]),
    counters: count,
    namedCounters: counters(12, 40),
    powerModifier: integer,
    toughnessModifier: integer,
    group: z.string().max(60),
    position: z
      .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
      .strict()
      .nullable(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    signature: z.string().max(400_000),
    state: z
      .object({
        seed: z.string().min(1).max(200),
        shuffleCount: z.number().int().min(0).max(1_000_000),
        turn: z.number().int().min(1).max(99999),
        life: integer,
        nextId: z.number().int().min(1).max(1_000_000),
        randomCount: z.number().int().min(0).max(1_000_000),
        randomResult: z.string().max(100),
        commanderTax: z.record(z.string().max(200), count),
        opponents: z
          .array(
            z
              .object({
                id: z.string().max(40),
                name: z.string().min(1).max(60),
                life: integer,
                damage: counters(16, 60),
              })
              .strict(),
          )
          .max(7),
        zones: z
          .object({
            library: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            hand: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            battlefield: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            graveyard: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            exile: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            commandZone: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
            sideboard: z.array(cardSchema).max(MAX_PLAYTEST_CARDS),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

function signature(entries: DeckSnapshotEntry[]) {
  return JSON.stringify(
    entries
      .map(({ id, cardId, cardName, section, quantity, isCommander }) => ({
        id,
        cardId,
        cardName,
        section,
        quantity,
        isCommander,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export function playtestStorageKey(viewer: string, deck: string) {
  return `mtg:playtest:v1:${encodeURIComponent(viewer)}:${encodeURIComponent(deck)}`;
}

export function serializePlaytest(
  state: PlaytestGameState,
  entries: DeckSnapshotEntry[],
) {
  const ids = new Set(entries.map((entry) => entry.id));
  const result = JSON.stringify({
    version: 1,
    signature: signature(entries),
    state: {
      ...state,
      zones: Object.fromEntries(
        PLAYTEST_ZONES.map((zone) => [
          zone,
          state.zones[zone].map(
            ({ entry, copyNumber: _copyNumber, ...card }) => ({
              ...card,
              entryId: ids.has(entry.id) ? entry.id : null,
              tokenName: ids.has(entry.id) ? null : entry.cardName,
            }),
          ),
        ]),
      ),
    },
  });
  if (new TextEncoder().encode(result).length > PLAYTEST_FILE_LIMIT)
    throw new Error("Playtest save exceeds the 1 MB limit.");
  // Keep export/restore contracts identical; never emit a file we cannot restore.
  restorePlaytest(result, entries);
  return result;
}

export function restorePlaytest(
  text: string,
  entries: DeckSnapshotEntry[],
): PlaytestGameState {
  if (new TextEncoder().encode(text).length > PLAYTEST_FILE_LIMIT)
    throw new Error("Playtest file exceeds the 1 MB limit.");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Playtest file is not valid JSON.");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Invalid or unsupported playtest file. Expected bounded version 1 state.",
    );
  if (parsed.data.signature !== signature(entries))
    throw new Error(
      "This saved playtest belongs to a different or changed deck. Clear it to start fresh; the saved file was not applied.",
    );
  const base = expandPlaytestDeck(entries);
  const originals = new Map(
    Object.values(base)
      .flat()
      .map((card) => [card.instanceId, card]),
  );
  const entryMap = new Map(
    Object.values(base)
      .flat()
      .map((card) => [card.entry.id, card.entry]),
  );
  const seen = new Set<string>();
  const seenOriginals = new Set<string>();
  const state = parsed.data.state;
  const zones = {} as PlaytestGameState["zones"];
  for (const zone of PLAYTEST_ZONES) {
    zones[zone] = state.zones[zone].map((saved): PlaytestCard => {
      const { entryId, tokenName, ...card } = saved;
      if (seen.has(card.instanceId) || seen.size >= MAX_PLAYTEST_CARDS)
        throw new Error("Duplicate or excessive playtest cards.");
      seen.add(card.instanceId);
      if (card.origin === "deck") {
        const original = originals.get(card.instanceId);
        if (!original || original.entry.id !== entryId || tokenName !== null)
          throw new Error("Missing or stale deck card in playtest file.");
        seenOriginals.add(card.instanceId);
        return { ...original, ...card };
      }
      const match = /^temporary:([1-9][0-9]*)$/.exec(card.instanceId);
      if (
        !match ||
        Number(match[1]) >= state.nextId ||
        (card.origin === "token" && entryId !== null)
      )
        throw new Error("Invalid temporary card identity.");
      const entry = entryId
        ? entryMap.get(entryId)
        : tokenName
          ? {
              id: card.instanceId,
              cardId: null,
              cardName: tokenName,
              section: DeckSection.MAINBOARD,
              quantity: 1,
              isCommander: false,
              card: null,
            }
          : null;
      if (!entry || (entryId !== null && tokenName !== null))
        throw new Error("Unknown temporary card source.");
      return { ...card, copyNumber: 1, entry };
    });
  }
  if (seenOriginals.size !== originals.size)
    throw new Error("Playtest file is missing deck cards.");
  const commanderIds = new Set(base.commandZone.map((card) => card.instanceId));
  if (
    Object.keys(state.commanderTax).length !== commanderIds.size ||
    Object.keys(state.commanderTax).some((id) => !commanderIds.has(id))
  )
    throw new Error("Invalid commander tax sources.");
  const playerIds = new Set<string>();
  for (const opponent of state.opponents) {
    const match = /^player:([1-9][0-9]*)$/.exec(opponent.id);
    if (
      !match ||
      Number(match[1]) >= state.nextId ||
      playerIds.has(opponent.id)
    )
      throw new Error("Invalid player panel identity.");
    playerIds.add(opponent.id);
  }
  // Card images/metadata are reconstructed only from the currently authorized snapshot.
  return { ...state, zones };
}
