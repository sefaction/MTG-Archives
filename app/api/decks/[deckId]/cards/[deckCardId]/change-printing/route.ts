import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageDeck } from "@/lib/decks";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string; deckCardId: string }> },
) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const { deckId, deckCardId } = await params;
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  if (!cardId) {
    return Response.json(
      { error: "Select a specific printing before changing this row." },
      { status: 400 },
    );
  }
  let updatedRows = 0;
  let mergedRows = 0;
  await prisma.$transaction(async (tx) => {
    const deckCard = await tx.deckCard.findFirst({
      where: { id: deckCardId, deckId },
    });
    if (!deckCard) throw new Error("Deck card not found.");
    if (deckCard.cardId === cardId) return;
    const proposed = await tx.card.findUnique({ where: { id: cardId } });
    if (!proposed) throw new Error("Selected printing was not found.");
    const duplicate = await tx.deckCard.findFirst({
      where: {
        deckId,
        cardId: proposed.id,
        section: deckCard.section,
        id: { not: deckCard.id },
      },
    });
    if (duplicate) {
      await tx.deckCard.update({
        where: { id: duplicate.id },
        data: {
          quantity: duplicate.quantity + deckCard.quantity,
          notes: duplicate.notes || deckCard.notes,
          isCommander: duplicate.isCommander || deckCard.isCommander,
        },
      });
      await tx.deckCard.delete({ where: { id: deckCard.id } });
      mergedRows += 1;
    } else {
      await tx.deckCard.update({
        where: { id: deckCard.id },
        data: {
          cardId: proposed.id,
          scryfallId: proposed.scryfallId,
          oracleId: proposed.oracleId,
          cardName: proposed.name,
        },
      });
      updatedRows += 1;
    }
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return Response.json({ updatedRows, mergedRows });
}
