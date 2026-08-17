"use server";

import {
  CommanderLeagueMemberRole,
  CommanderLeagueResult,
  DefaultCollectionVisibility,
  Visibility,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { pointsForResult } from "@/lib/commander-league";
import { prisma } from "@/lib/prisma";

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function integer(formData: FormData, name: string, fallback?: number) {
  const raw = text(formData, name);
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : Number.NaN;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function leagueMonths(year: number) {
  return Array.from({ length: 12 }, (_, index) => ({
    monthNumber: index + 1,
    name: new Intl.DateTimeFormat("en-US", { month: "long" }).format(
      new Date(Date.UTC(year, index, 1)),
    ),
    startDate: new Date(Date.UTC(year, index, 1)),
    endDate: new Date(Date.UTC(year, index + 1, 0, 23, 59, 59, 999)),
  }));
}

async function requireLeagueAdmin(leagueId: string) {
  const user = await requireLogin();
  const membership = await prisma.commanderLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  if (!membership || !membership.active || membership.role !== "ADMIN") {
    fail(`/league/${leagueId}`, "League administrator access is required.");
  }
  return user;
}

async function requireLeagueMember(leagueId: string) {
  const user = await requireLogin();
  const membership = await prisma.commanderLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  if (!membership?.active) {
    fail(`/league/${leagueId}`, "Active league membership is required.");
  }
  return { user, membership };
}

export async function createCommanderLeague(formData: FormData) {
  const user = await requireLogin();
  if (!user.playerId) {
    fail("/league", "Your archive account must be linked to a player first.");
  }

  const name = text(formData, "name");
  const description = text(formData, "description") || null;
  const year = integer(formData, "year");
  const winPoints = integer(formData, "winPoints", 3);
  const drawPoints = integer(formData, "drawPoints", 1);
  const lossPoints = integer(formData, "lossPoints", 0);
  if (!name || name.length > 120) fail("/league", "Enter a league name.");
  if (year < 2020 || year > 2200) fail("/league", "Enter a valid league year.");
  if (
    [winPoints, drawPoints, lossPoints].some(
      (value) => !Number.isInteger(value),
    )
  ) {
    fail("/league", "Scoring values must be whole numbers.");
  }

  const selectedUserIds = new Set(
    formData.getAll("memberUserId").map(String).filter(Boolean),
  );
  selectedUserIds.add(user.id);
  const selectedLocationIds = new Set(
    formData.getAll("locationId").map(String).filter(Boolean),
  );
  const members = await prisma.user.findMany({
    where: {
      id: { in: [...selectedUserIds] },
      isActive: true,
      playerId: { not: null },
    },
    select: {
      id: true,
      playerId: true,
      inventoryDefaultVisibility: true,
    },
  });
  if (members.length !== selectedUserIds.size) {
    fail(
      "/league",
      "Every league player must be an active archive user linked to a player.",
    );
  }

  const memberByPlayer = new Map(
    members.map((member) => [member.playerId!, member]),
  );
  const locations = selectedLocationIds.size
    ? await prisma.inventoryLocation.findMany({
        where: {
          id: { in: [...selectedLocationIds] },
          active: true,
          ownerPlayerId: { in: [...memberByPlayer.keys()] },
        },
        select: { id: true, ownerPlayerId: true, visibility: true },
      })
    : [];
  if (locations.length !== selectedLocationIds.size) {
    fail("/league", "League locations must belong to selected league players.");
  }
  const privateLocation = locations.find((location) => {
    const owner = memberByPlayer.get(location.ownerPlayerId)!;
    return !(
      location.visibility === Visibility.PUBLIC ||
      (location.visibility === Visibility.INHERIT &&
        owner.inventoryDefaultVisibility === DefaultCollectionVisibility.PUBLIC)
    );
  });
  if (privateLocation) {
    fail(
      "/league",
      "Every league inventory location must be publicly visible.",
    );
  }

  const baseSlug = `${slugify(name) || "commander-league"}-${year}`;
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.commanderLeague.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const league = await prisma.commanderLeague.create({
    data: {
      name,
      slug,
      description,
      year,
      winPoints,
      drawPoints,
      lossPoints,
      createdByUserId: user.id,
      rounds: { create: leagueMonths(year) },
      members: {
        create: members.map((member) => ({
          userId: member.id,
          role:
            member.id === user.id
              ? CommanderLeagueMemberRole.ADMIN
              : CommanderLeagueMemberRole.PLAYER,
        })),
      },
      locations: {
        create: locations.map((location) => ({ locationId: location.id })),
      },
    },
  });
  redirect(`/league/${league.id}`);
}

export async function addLeagueMember(formData: FormData) {
  const leagueId = text(formData, "leagueId");
  const userId = text(formData, "userId");
  await requireLeagueAdmin(leagueId);
  const candidate = await prisma.user.findFirst({
    where: { id: userId, isActive: true, playerId: { not: null } },
  });
  if (!candidate)
    fail(
      `/league/${leagueId}`,
      "Select an active archive user linked to a player.",
    );
  await prisma.commanderLeagueMember.upsert({
    where: { leagueId_userId: { leagueId, userId } },
    create: { leagueId, userId },
    update: { active: true },
  });
  revalidatePath(`/league/${leagueId}`);
}

export async function addLeagueLocation(formData: FormData) {
  const leagueId = text(formData, "leagueId");
  const locationId = text(formData, "locationId");
  await requireLeagueAdmin(leagueId);
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: locationId },
    include: {
      ownerPlayer: {
        include: {
          users: {
            where: {
              commanderLeagueMemberships: { some: { leagueId, active: true } },
            },
          },
        },
      },
    },
  });
  const ownerUser = location?.ownerPlayer.users[0];
  const isPublic =
    location?.visibility === Visibility.PUBLIC ||
    (location?.visibility === Visibility.INHERIT &&
      ownerUser?.inventoryDefaultVisibility ===
        DefaultCollectionVisibility.PUBLIC);
  if (!location || !location.active || !ownerUser || !isPublic) {
    fail(
      `/league/${leagueId}`,
      "Select a public location owned by an active league player.",
    );
  }
  await prisma.commanderLeagueLocation.upsert({
    where: { leagueId_locationId: { leagueId, locationId } },
    create: { leagueId, locationId },
    update: {},
  });
  revalidatePath(`/league/${leagueId}`);
}

export async function removeLeagueLocation(formData: FormData) {
  const leagueId = text(formData, "leagueId");
  const locationId = text(formData, "locationId");
  await requireLeagueAdmin(leagueId);
  await prisma.commanderLeagueLocation.deleteMany({
    where: { leagueId, locationId },
  });
  revalidatePath(`/league/${leagueId}`);
}

export async function createLeagueDeck(formData: FormData) {
  const leagueId = text(formData, "leagueId");
  const { membership } = await requireLeagueMember(leagueId);
  const memberId = text(formData, "memberId");
  const roundId = text(formData, "roundId");
  const name = text(formData, "name");
  const description = text(formData, "description") || null;
  if (!name || name.length > 120) {
    fail(`/league/${leagueId}/decks`, "Enter a deck name.");
  }
  const targetMember = await prisma.commanderLeagueMember.findFirst({
    where: { id: memberId, leagueId, active: true },
  });
  const round = await prisma.commanderLeagueRound.findFirst({
    where: { id: roundId, leagueId },
  });
  if (!targetMember || !round) {
    fail(
      `/league/${leagueId}/decks`,
      "Select a league player and submission month.",
    );
  }
  if (
    membership.role !== CommanderLeagueMemberRole.ADMIN &&
    targetMember.id !== membership.id
  ) {
    fail(
      `/league/${leagueId}/decks`,
      "Only league administrators can create a deck for another player.",
    );
  }
  const existing = await prisma.commanderLeagueDeck.findFirst({
    where: { memberId: targetMember.id, roundId: round.id },
  });
  if (existing) {
    fail(
      `/league/${leagueId}/decks`,
      `${round.name} already has a submitted deck for this player.`,
    );
  }
  const deck = await prisma.$transaction(async (tx) => {
    const archiveDeck = await tx.deck.create({
      data: {
        ownerUserId: targetMember.userId,
        name,
        description,
        format: "COMMANDER",
        visibility: "PUBLIC",
      },
    });
    return tx.commanderLeagueDeck.create({
      data: {
        leagueId,
        memberId: targetMember.id,
        roundId: round.id,
        archiveDeckId: archiveDeck.id,
        name,
        description,
      },
    });
  });
  redirect(`/league/${leagueId}/decks/${deck.id}`);
}

export async function createLeagueGame(formData: FormData) {
  const leagueId = text(formData, "leagueId");
  const roundId = text(formData, "roundId");
  const user = await requireLeagueAdmin(leagueId);
  const participantCount = integer(formData, "participantCount");
  if (participantCount < 2 || participantCount > 8) {
    fail(
      `/league/${leagueId}`,
      "A Commander game needs between 2 and 8 players.",
    );
  }
  const playedAt = new Date(text(formData, "playedAt"));
  if (Number.isNaN(playedAt.getTime()))
    fail(`/league/${leagueId}`, "Enter a valid game date.");

  const league = await prisma.commanderLeague.findUnique({
    where: { id: leagueId },
    include: {
      rounds: true,
      members: {
        where: { active: true },
        include: {
          user: true,
          decks: { include: { archiveDeck: { include: { cards: true } } } },
        },
      },
    },
  });
  const round = league?.rounds.find((item) => item.id === roundId);
  if (!league || !round) fail(`/league/${leagueId}`, "Select a league round.");
  if (playedAt < round.startDate || playedAt > round.endDate) {
    fail(
      `/league/${leagueId}`,
      "The game date must fall within the selected monthly round.",
    );
  }

  const memberById = new Map(
    league.members.map((member) => [member.id, member]),
  );
  const entries = Array.from({ length: participantCount }, (_, index) => {
    const memberId = text(formData, `memberId_${index}`);
    const deckId = text(formData, `deckId_${index}`);
    const result = text(formData, `result_${index}`) as CommanderLeagueResult;
    const finishRaw = text(formData, `finishPosition_${index}`);
    const finishPosition = finishRaw ? Number(finishRaw) : null;
    return { memberId, deckId, result, finishPosition };
  });
  if (
    entries.some(
      (entry) => !Object.values(CommanderLeagueResult).includes(entry.result),
    )
  ) {
    fail(`/league/${leagueId}`, "Select a valid result for every player.");
  }
  if (new Set(entries.map((entry) => entry.memberId)).size !== entries.length) {
    fail(`/league/${leagueId}`, "Each game participant must be unique.");
  }
  if (entries.some((entry) => !memberById.has(entry.memberId))) {
    fail(
      `/league/${leagueId}`,
      "Every participant must be an active league player.",
    );
  }
  const allDraw = entries.every(
    (entry) => entry.result === CommanderLeagueResult.DRAW,
  );
  if (allDraw) {
    if (entries.some((entry) => entry.finishPosition !== null)) {
      fail(
        `/league/${leagueId}`,
        "Drawn games should not include an elimination order.",
      );
    }
  } else {
    const winners = entries.filter(
      (entry) => entry.result === CommanderLeagueResult.WIN,
    );
    const positions = entries.map((entry) => entry.finishPosition);
    if (
      winners.length !== 1 ||
      winners[0].finishPosition !== 1 ||
      entries.some((entry) => entry.result === CommanderLeagueResult.DRAW) ||
      positions.some(
        (position) => !position || position < 1 || position > participantCount,
      ) ||
      new Set(positions).size !== participantCount
    ) {
      fail(
        `/league/${leagueId}`,
        "Completed games need one winner in first place and a unique elimination finish for every player.",
      );
    }
  }

  const prepared = entries.map((entry) => {
    const member = memberById.get(entry.memberId)!;
    const deck = member.decks.find(
      (candidate) => candidate.id === entry.deckId,
    );
    if (!deck)
      fail(
        `/league/${leagueId}`,
        `Select a deck owned by ${member.user.displayName}.`,
      );
    if (deck.roundId !== roundId) {
      fail(
        `/league/${leagueId}`,
        `Select ${round.name}'s submitted deck for ${member.user.displayName}.`,
      );
    }
    return { entry, deck };
  });

  await prisma.$transaction(async (tx) => {
    const game = await tx.commanderLeagueGame.create({
      data: {
        leagueId,
        roundId,
        playedAt,
        notes: text(formData, "notes") || null,
        createdByUserId: user.id,
      },
    });
    for (const { entry, deck } of prepared) {
      await tx.commanderLeagueGameParticipant.create({
        data: {
          gameId: game.id,
          memberId: entry.memberId,
          result: entry.result,
          finishPosition: entry.finishPosition,
          pointsAwarded: pointsForResult(entry.result, league),
          deckSubmission: {
            create: {
              sourceLeagueDeckId: deck.id,
              deckName: deck.archiveDeck.name,
              cards: {
                create: deck.archiveDeck.cards.map((card) => ({
                  cardId: card.cardId,
                  scryfallId: card.scryfallId,
                  oracleId: card.oracleId,
                  cardName: card.cardName,
                  section: card.section,
                  quantity: card.quantity,
                  isCommander: card.isCommander,
                })),
              },
            },
          },
        },
      });
    }
  });
  revalidatePath(`/league/${leagueId}`);
}
