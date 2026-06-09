import { DeckSection } from "@prisma/client";
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { canManageDeck } from "@/lib/decks";
import { prisma } from "@/lib/prisma";
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
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { ownerUser: { select: { playerId: true } } },
  });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const rowIds = Array.isArray(body.rowIds)
    ? body.rowIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const section = Object.values(DeckSection).includes(body.section)
    ? (body.section as DeckSection)
    : null;
  if (!rowIds.length || !section) {
    return Response.json(
      { error: "Select deck rows and a destination section." },
      { status: 400 },
    );
  }
  const maybeboardCommittedMode =
    typeof body.maybeboardCommittedMode === "string"
      ? body.maybeboardCommittedMode
      : "";
  const destinationLocationId =
    typeof body.destinationLocationId === "string"
      ? body.destinationLocationId
      : "";
  let movedRows = 0;
  let mergedRows = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const deckCards = await tx.deckCard.findMany({
        where: { deckId, id: { in: rowIds } },
        orderBy: { cardName: "asc" },
      });
      const ownerPlayerId = deck.ownerUser.playerId;
      if (section === DeckSection.MAYBEBOARD && ownerPlayerId) {
        const committed = await getDeckCommittedSummary(tx, {
          deckId,
          ownerPlayerId,
        });
        const committedCardIds = deckCards
          .map((row) => row.cardId)
          .filter((cardId): cardId is string =>
            Boolean(cardId && committed.byCardId[cardId]),
          );
        if (committedCardIds.length) {
          if (maybeboardCommittedMode === "return") {
            await returnCommittedInventoryFromDeckTx(tx, {
              actorUserId: user.id,
              ownerPlayerId,
              deckId,
              deckName: deck.name,
              destinationLocationId,
              mode: "returned_from_deck_for_maybeboard",
              cardIds: committedCardIds,
            });
          } else if (maybeboardCommittedMode !== "keep") {
            throw new Error(
              "Return committed copies to inventory or explicitly keep them committed before moving selected rows to Maybeboard.",
            );
          }
        }
      }
      for (const deckCard of deckCards) {
        if (deckCard.section === section) continue;
        const duplicate = deckCard.cardId
          ? await tx.deckCard.findFirst({
              where: {
                deckId,
                cardId: deckCard.cardId,
                section,
                id: { not: deckCard.id },
              },
            })
          : null;
        if (duplicate) {
          await tx.deckCard.update({
            where: { id: duplicate.id },
            data: {
              quantity: duplicate.quantity + deckCard.quantity,
              notes: duplicate.notes || deckCard.notes,
              isCommander:
                duplicate.isCommander || section === DeckSection.COMMANDER,
            },
          });
          await tx.deckCard.delete({ where: { id: deckCard.id } });
          mergedRows += 1;
        } else {
          await tx.deckCard.update({
            where: { id: deckCard.id },
            data: { section, isCommander: section === DeckSection.COMMANDER },
          });
          movedRows += 1;
        }
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bulk move failed." },
      { status: 400 },
    );
  }
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  revalidatePath("/inventory");
  revalidatePath("/locations");
  return Response.json({ movedRows, mergedRows });
}
