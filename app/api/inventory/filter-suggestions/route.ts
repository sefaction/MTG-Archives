import { NextResponse } from "next/server";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPublicInventoryWhere } from "@/lib/public-collection";
import {
  buildPrivateSuggestionInventoryWhere,
  extractTypeLineTokensFromCard,
  suggestionScopeSearchParams,
  type InventoryFilterSuggestion,
  type InventorySuggestionKind,
} from "@/lib/inventory-filter-suggestions";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

function parseLimit(value: string | null) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function optionResponse(
  suggestions: InventoryFilterSuggestion[],
  totalCandidates: number,
  limit: number,
) {
  return NextResponse.json({
    suggestions: suggestions.slice(0, limit),
    hasMore: totalCandidates > limit,
  });
}

function normalizeKind(value: string | null): InventorySuggestionKind | null {
  if (value === "cardName" || value === "typeLine" || value === "set")
    return value;
  return null;
}

async function cardNameSuggestions({
  inventoryWhere,
  q,
  limit,
}: {
  inventoryWhere: any;
  q: string;
  limit: number;
}) {
  const cards = await prisma.card.findMany({
    where: {
      name: { contains: q, mode: "insensitive" },
      inventoryItems: { some: inventoryWhere },
    },
    select: { name: true },
    distinct: ["name"],
    orderBy: { name: "asc" },
    take: limit + 1,
  });
  return optionResponse(
    cards.map((card) => ({ value: card.name, label: card.name })),
    cards.length,
    limit,
  );
}

async function setSuggestions({
  inventoryWhere,
  q,
  limit,
}: {
  inventoryWhere: any;
  q: string;
  limit: number;
}) {
  const sets = await prisma.card.findMany({
    where: {
      OR: [
        { setCode: { contains: q.toLowerCase() } },
        { setName: { contains: q, mode: "insensitive" } },
      ],
      inventoryItems: { some: inventoryWhere },
    },
    select: { setCode: true, setName: true },
    distinct: ["setCode"],
    orderBy: { setCode: "asc" },
    take: limit + 1,
  });
  return optionResponse(
    sets.map((set) => ({
      value: set.setCode,
      label: `${set.setCode.toUpperCase()} — ${set.setName || set.setCode.toUpperCase()}`,
      description: set.setCode.toUpperCase(),
    })),
    sets.length,
    limit,
  );
}

async function typeLineSuggestions({
  inventoryWhere,
  q,
  limit,
}: {
  inventoryWhere: any;
  q: string;
  limit: number;
}) {
  const cards = await prisma.card.findMany({
    where: { inventoryItems: { some: inventoryWhere } },
    select: { typeLine: true, cardFaces: true },
    distinct: ["typeLine"],
    orderBy: { typeLine: "asc" },
    take: 5000,
  });
  const needle = q.toLowerCase();
  const seen = new Set<string>();
  const tokens: InventoryFilterSuggestion[] = [];
  for (const card of cards) {
    for (const token of extractTypeLineTokensFromCard(card)) {
      const key = token.toLowerCase();
      if (seen.has(key) || !key.includes(needle)) continue;
      seen.add(key);
      tokens.push({ value: token, label: token });
    }
  }
  tokens.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  );
  return optionResponse(tokens, tokens.length, limit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = normalizeKind(url.searchParams.get("kind"));
  const q = (url.searchParams.get("q") || "").trim();
  const limit = parseLimit(url.searchParams.get("limit"));
  if (!kind) {
    return NextResponse.json(
      { error: "Unknown suggestion kind." },
      { status: 400 },
    );
  }
  if (q.length < 1) return optionResponse([], 0, limit);

  const isPublic = url.searchParams.get("public") === "1";
  const inventoryWhere = isPublic
    ? buildPublicInventoryWhere(
        Object.fromEntries(
          suggestionScopeSearchParams(url.searchParams),
        ) as any,
      )
    : await (async () => {
        const user = await getCurrentUser();
        if (!user) return null;
        const accessScope = await getAccessScope(user);
        return buildPrivateSuggestionInventoryWhere({
          params: url.searchParams,
          adminModeActive: accessScope?.mode === "admin",
          playerId: user.playerId,
        });
      })();

  if (!inventoryWhere) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (kind === "cardName")
    return cardNameSuggestions({ inventoryWhere, q, limit });
  if (kind === "set") return setSuggestions({ inventoryWhere, q, limit });
  return typeLineSuggestions({ inventoryWhere, q, limit });
}
