import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import { searchDeckCardPrintings } from "@/lib/deck-search";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await requireLogin();
  const leagueId = request.nextUrl.searchParams.get("leagueId") || "";
  const membership = await prisma.commanderLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  if (!membership?.active) return Response.json({ error: "League membership required." }, { status: 403 });
  const result = await searchDeckCardPrintings({
    query: request.nextUrl.searchParams.get("q") || "",
    ownerPlayerId: null,
    includeScryfall: true,
    limit: 75,
  });
  return Response.json(result);
}
