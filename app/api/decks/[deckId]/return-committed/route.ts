import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { canManageDeck } from "@/lib/decks";
import { prisma } from "@/lib/prisma";
import { returnCommittedInventoryFromDeckTx } from "@/lib/deck-inventory";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const { deckId } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { ownerUser: { select: { playerId: true } } },
  });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  const ownerPlayerId = deck.ownerUser.playerId;
  if (!ownerPlayerId) {
    return Response.json(
      { error: "Deck owner does not have an inventory owner profile." },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const destinationLocationId =
    typeof body.destinationLocationId === "string"
      ? body.destinationLocationId
      : "";
  const rowIds = Array.isArray(body.rowIds)
    ? body.rowIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const quantity = Number(body.quantity);
  let cardIds: string[] | undefined;
  if (rowIds.length) {
    const rows = await prisma.deckCard.findMany({
      where: { deckId, id: { in: rowIds }, cardId: { not: null } },
      select: { cardId: true },
    });
    cardIds = rows
      .map((row) => row.cardId)
      .filter((id): id is string => Boolean(id));
    if (!cardIds.length) {
      return Response.json(
        { error: "Selected rows do not have committed printable cards." },
        { status: 400 },
      );
    }
  } else if (typeof body.cardId === "string" && body.cardId) {
    cardIds = [body.cardId];
  }
  try {
    const result = await prisma.$transaction((tx) =>
      returnCommittedInventoryFromDeckTx(tx, {
        actorUserId: user.id,
        ownerPlayerId,
        deckId,
        deckName: deck.name,
        destinationLocationId,
        mode: rowIds.length ? "bulk_returned_from_deck" : "returned_from_deck",
        cardIds,
        maxQuantity:
          Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
      }),
    );
    revalidatePath(`/decks/${deckId}`);
    revalidatePath("/inventory");
    revalidatePath("/locations");
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Return failed." },
      { status: 400 },
    );
  }
}
