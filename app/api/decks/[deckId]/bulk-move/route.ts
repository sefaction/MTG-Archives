import { DeckSection } from "@prisma/client";
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { canManageDeck } from "@/lib/decks";
import { prisma } from "@/lib/prisma";

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
  let movedRows = 0;
  let mergedRows = 0;
  await prisma.$transaction(async (tx) => {
    const deckCards = await tx.deckCard.findMany({
      where: { deckId, id: { in: rowIds } },
      orderBy: { cardName: "asc" },
    });
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
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return Response.json({ movedRows, mergedRows });
}
