import type { CurrentUser } from "@/lib/auth";
import { canManageDeck } from "@/lib/decks";
import { prisma } from "@/lib/prisma";

export async function getDeckManagementPolicy(
  deckId: string,
  user: CurrentUser,
  appAdminMode: boolean,
) {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: {
      ownerUser: { select: { playerId: true } },
      commanderLeagueDeck: {
        include: {
          submissions: { select: { id: true } },
          league: {
            include: {
              members: { where: { userId: user.id, active: true } },
            },
          },
        },
      },
    },
  });
  const leagueAdmin = deck?.commanderLeagueDeck?.league.members.some(
    (member) => member.role === "ADMIN",
  );
  return {
    deck,
    canManage: Boolean(
      deck && (canManageDeck(user, deck, appAdminMode) || leagueAdmin),
    ),
    locked: Boolean(deck?.commanderLeagueDeck?.submissions.length),
    isLeagueDeck: Boolean(deck?.commanderLeagueDeck),
  };
}
