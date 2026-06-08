import { NextRequest } from "next/server";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageDeck } from "@/lib/decks";
import { revalidatePath } from "next/cache";

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
  const body = await request.json().catch(() => ({}));
  const changes = Array.isArray(body.changes)
    ? body.changes.filter(
        (change: any) =>
          change?.include !== false &&
          typeof change?.deckCardId === "string" &&
          typeof change?.proposedCardId === "string" &&
          change.deckCardId !== "" &&
          change.proposedCardId !== "",
      )
    : [];
  if (changes.length === 0)
    return Response.json({ updatedRows: 0, mergedRows: 0 });
  let updatedRows = 0;
  let mergedRows = 0;
  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      const deckCard = await tx.deckCard.findFirst({
        where: { id: change.deckCardId, deckId },
        include: { card: true },
      });
      if (!deckCard || deckCard.cardId === change.proposedCardId) continue;
      const proposed = await tx.card.findUnique({
        where: { id: change.proposedCardId },
      });
      if (!proposed) continue;
      const existing = await tx.deckCard.findFirst({
        where: {
          deckId,
          cardId: proposed.id,
          section: deckCard.section,
          id: { not: deckCard.id },
        },
      });
      if (existing) {
        await tx.deckCard.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + deckCard.quantity,
            notes: existing.notes || deckCard.notes,
            isCommander: existing.isCommander || deckCard.isCommander,
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
    }
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return Response.json({ updatedRows, mergedRows });
}
