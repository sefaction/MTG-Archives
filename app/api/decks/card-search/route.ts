import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import { searchDeckCardPrintings } from "@/lib/deck-search";

export async function GET(request: NextRequest) {
  const user = await requireLogin();
  const q = request.nextUrl.searchParams.get("q") || "";
  const includeScryfall = request.nextUrl.searchParams.get("scryfall") === "1";
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const requestedLimit = rawLimit === null ? NaN : Number(rawLimit);
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 175))
    : undefined;
  const result = await searchDeckCardPrintings({
    query: q,
    ownerPlayerId: user.playerId,
    includeScryfall,
    limit,
  });
  return Response.json(result);
}
