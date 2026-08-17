export type CommanderLeagueResultValue = "WIN" | "LOSS" | "DRAW";

export type LeagueScoring = {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
};

export type StandingResult = {
  memberId: string;
  displayName: string;
  result: CommanderLeagueResultValue;
  pointsAwarded: number;
  finishPosition: number | null;
  participantCount: number;
};

export type LeagueStanding = {
  memberId: string;
  displayName: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  finishScore: number;
  averageFinish: number | null;
};

export function pointsForResult(
  result: CommanderLeagueResultValue,
  scoring: LeagueScoring,
) {
  if (result === "WIN") return scoring.winPoints;
  if (result === "DRAW") return scoring.drawPoints;
  return scoring.lossPoints;
}

export function finishScore(
  participantCount: number,
  finishPosition: number | null,
) {
  if (!finishPosition) return 0;
  return Math.max(0, participantCount - finishPosition + 1);
}

export function buildLeagueStandings(results: StandingResult[]) {
  const rows = new Map<string, LeagueStanding & { finishTotal: number }>();

  for (const result of results) {
    const row = rows.get(result.memberId) ?? {
      memberId: result.memberId,
      displayName: result.displayName,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      finishScore: 0,
      averageFinish: null,
      finishTotal: 0,
    };
    row.games += 1;
    row.points += result.pointsAwarded;
    if (result.result === "WIN") row.wins += 1;
    if (result.result === "LOSS") row.losses += 1;
    if (result.result === "DRAW") row.draws += 1;
    if (result.finishPosition) {
      row.finishTotal += result.finishPosition;
      row.finishScore += finishScore(
        result.participantCount,
        result.finishPosition,
      );
    }
    row.averageFinish = row.finishTotal ? row.finishTotal / row.games : null;
    rows.set(result.memberId, row);
  }

  return [...rows.values()]
    .map(({ finishTotal: _finishTotal, ...row }) => row)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.finishScore - a.finishScore ||
        b.wins - a.wins ||
        a.displayName.localeCompare(b.displayName),
    );
}

export type SnapshotCardInput = {
  cardName: string;
  oracleId: string | null;
  quantity: number;
  isCommander: boolean;
};

export function buildLeagueCardStats(cards: SnapshotCardInput[]) {
  const cardsByIdentity = new Map<
    string,
    { cardName: string; copies: number; appearances: number }
  >();
  const commanders = new Map<
    string,
    { cardName: string; appearances: number }
  >();

  for (const card of cards) {
    const key = card.oracleId || card.cardName.toLowerCase();
    const current = cardsByIdentity.get(key) ?? {
      cardName: card.cardName,
      copies: 0,
      appearances: 0,
    };
    current.copies += card.quantity;
    current.appearances += 1;
    cardsByIdentity.set(key, current);

    if (card.isCommander) {
      const commander = commanders.get(key) ?? {
        cardName: card.cardName,
        appearances: 0,
      };
      commander.appearances += 1;
      commanders.set(key, commander);
    }
  }

  return {
    uniqueCards: cardsByIdentity.size,
    totalCopies: cards.reduce((sum, card) => sum + card.quantity, 0),
    topCards: [...cardsByIdentity.values()]
      .sort(
        (a, b) =>
          b.appearances - a.appearances ||
          b.copies - a.copies ||
          a.cardName.localeCompare(b.cardName),
      )
      .slice(0, 12),
    commanders: [...commanders.values()]
      .sort(
        (a, b) =>
          b.appearances - a.appearances || a.cardName.localeCompare(b.cardName),
      )
      .slice(0, 12),
  };
}
