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
  if (!rowIds.length) {
    return Response.json(
      { error: "Select deck entries to remove." },
      { status: 400 },
    );
  }
  const rows = await prisma.deckCard.findMany({
    where: { deckId, id: { in: rowIds } },
    select: { id: true, quantity: true },
  });
  const deletedQuantity = rows.reduce((total, row) => total + row.quantity, 0);
  await prisma.deckCard.deleteMany({
    where: { deckId, id: { in: rows.map((row) => row.id) } },
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return Response.json({ deletedRows: rows.length, deletedQuantity });
}
