import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function LeagueDeckBuilderRedirect({
  params,
}: {
  params: Promise<{ leagueId: string; deckId: string }>;
}) {
  const { leagueId, deckId } = await params;
  const deck = await prisma.commanderLeagueDeck.findFirst({
    where: { id: deckId, leagueId },
    select: { archiveDeckId: true },
  });
  if (!deck) notFound();
  redirect(`/decks/${deck.archiveDeckId}`);
}
