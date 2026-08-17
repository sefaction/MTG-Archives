import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDeckManagementPolicy } from "@/lib/deck-management-policy";
import {
  getDeckCommittedSummary,
  returnCommittedInventoryFromDeckTx,
} from "@/lib/deck-inventory";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const { deckId } = await params;
  const policy = await getDeckManagementPolicy(
    deckId,
    user,
    scope?.mode === "admin",
  );
  const { deck } = policy;
  if (!deck || !policy.canManage) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  if (policy.locked) {
    return Response.json(
      { error: "This League deck is locked." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const rowIds = Array.isArray(body.rowIds)
    ? body.rowIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (!rowIds.length) {
    return Response.json(
      { error: "Select deck entries to remove." },
      { status: 400 },
    );
  }
  const destinationLocationId =
    typeof body.destinationLocationId === "string"
      ? body.destinationLocationId
      : "";
  try {
    let deletedQuantity = 0;
    let deletedRows = 0;
    await prisma.$transaction(async (tx) => {
      const rows = await tx.deckCard.findMany({
        where: { deckId, id: { in: rowIds } },
        select: { id: true, quantity: true, cardId: true },
      });
      const ownerPlayerId = deck.ownerUser.playerId;
      if (ownerPlayerId) {
        const committed = await getDeckCommittedSummary(tx, {
          deckId,
          ownerPlayerId,
        });
        const committedCardIds = rows
          .map((row) => row.cardId)
          .filter((cardId): cardId is string =>
            Boolean(cardId && committed.byCardId[cardId]),
          );
        if (committedCardIds.length) {
          if (!destinationLocationId) {
            throw new Error(
              "Selected rows have committed physical cards. Choose a destination location to return them before removing deck-list rows.",
            );
          }
          await returnCommittedInventoryFromDeckTx(tx, {
            actorUserId: user.id,
            ownerPlayerId,
            deckId,
            deckName: deck.name,
            destinationLocationId,
            mode: "returned_from_deck_for_remove",
            cardIds: committedCardIds,
          });
        }
      }
      deletedQuantity = rows.reduce((total, row) => total + row.quantity, 0);
      deletedRows = rows.length;
      await tx.deckCard.deleteMany({
        where: { deckId, id: { in: rows.map((row) => row.id) } },
      });
    });
    revalidatePath(`/decks/${deckId}`);
    revalidatePath("/decks");
    revalidatePath("/inventory");
    revalidatePath("/locations");
    return Response.json({ deletedRows, deletedQuantity });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bulk remove failed." },
      { status: 400 },
    );
  }
}
