import { NextRequest } from "next/server";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageDeck } from "@/lib/decks";
import {
  buildDeckOptimizationPreview,
  DeckOptimizationMode,
} from "@/lib/deck-optimization";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const { deckId } = await params;
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!user.playerId) {
    return Response.json(
      { error: "Your account is not linked to an inventory owner." },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const mode: DeckOptimizationMode =
    body.mode === "cheapest" ? "cheapest" : "owned";
  const rowIds = Array.isArray(body.rowIds)
    ? body.rowIds.filter((id: unknown): id is string => typeof id === "string")
    : undefined;
  const preview = await buildDeckOptimizationPreview({
    deckId,
    ownerPlayerId: user.playerId,
    mode,
    rowIds,
  });
  return Response.json(preview);
}
