import { notFound } from "next/navigation";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { formatDecklistText, decklistFilename } from "@/lib/deck-export";
import { canViewDeck } from "@/lib/decks";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const user = await getCurrentUser();
  const scope = user ? await getAccessScope(user) : null;
  const { deckId } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: {
      ownerUser: { select: { deckDefaultVisibility: true, isActive: true } },
      cards: {
        select: {
          section: true, quantity: true, cardName: true,
          card: { select: { setCode: true, collectorNumber: true } },
        },
      },
    },
  });
  if (!deck || !canViewDeck(user, deck, scope?.mode === "admin")) notFound();

  return new Response(formatDecklistText(deck.cards), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${decklistFilename(deck.name)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
