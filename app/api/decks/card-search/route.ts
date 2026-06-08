import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import { searchDeckCardPrintings } from "@/lib/deck-search";

export async function GET(request: NextRequest) {
  const user = await requireLogin();
  const q = request.nextUrl.searchParams.get("q") || "";
  const includeScryfall = request.nextUrl.searchParams.get("scryfall") === "1";
  const result = await searchDeckCardPrintings({
    query: q,
    ownerPlayerId: user.playerId,
    includeScryfall,
  });
  return Response.json(result);
}
