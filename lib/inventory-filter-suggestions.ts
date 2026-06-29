import type { Prisma } from "@prisma/client";
import {
  buildInventoryWhereFromFilters,
  parseInventoryFilters,
} from "./inventory-filters";

export type InventorySuggestionKind = "cardName" | "typeLine" | "set";

export type InventoryFilterSuggestion = {
  value: string;
  label: string;
  description?: string;
};

const SCOPE_FILTER_KEYS = [
  "ownerId",
  "owner",
  "locationId",
  "locationName",
  "locationType",
  "location",
  "hasLocation",
  "visibility",
  "source",
  "language",
  "commitment",
  "finish",
  "foil",
] as const;

export function titleCaseInventoryToken(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function extractTypeLineTokens(...typeLines: Array<unknown>) {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const typeLine of typeLines) {
    if (typeof typeLine !== "string") continue;
    const normalized = typeLine
      .replace(/\/\//g, " ")
      .replace(/[—–-]/g, " ")
      .replace(/[^\p{L}\p{N}'\s]/gu, " ")
      .split(/\s+/u)
      .map((token) => token.replace(/^'+|'+$/g, "").trim())
      .filter((token) => /[\p{L}\p{N}]/u.test(token));
    for (const raw of normalized) {
      const token = titleCaseInventoryToken(raw);
      const key = token.toLowerCase();
      if (!token || seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
}

export function extractTypeLineTokensFromCard(card: {
  typeLine?: string | null;
  cardFaces?: unknown;
}) {
  const faceTypeLines: string[] = [];
  if (Array.isArray(card.cardFaces)) {
    for (const face of card.cardFaces) {
      if (
        face &&
        typeof face === "object" &&
        "type_line" in face &&
        typeof (face as { type_line?: unknown }).type_line === "string"
      ) {
        faceTypeLines.push((face as { type_line: string }).type_line);
      }
      if (
        face &&
        typeof face === "object" &&
        "typeLine" in face &&
        typeof (face as { typeLine?: unknown }).typeLine === "string"
      ) {
        faceTypeLines.push((face as { typeLine: string }).typeLine);
      }
    }
  }
  return extractTypeLineTokens(card.typeLine, ...faceTypeLines);
}

export function suggestionScopeSearchParams(params: URLSearchParams) {
  const scoped = new URLSearchParams();
  for (const key of SCOPE_FILTER_KEYS) {
    for (const value of params.getAll(key)) {
      if (value) scoped.append(key, value);
    }
  }
  return scoped;
}

export function buildPrivateSuggestionInventoryWhere({
  params,
  adminModeActive,
  playerId,
}: {
  params: URLSearchParams;
  adminModeActive: boolean;
  playerId?: string | null;
}): Prisma.InventoryItemWhereInput {
  const filters = parseInventoryFilters(suggestionScopeSearchParams(params));
  return buildInventoryWhereFromFilters(filters, { adminModeActive, playerId });
}
