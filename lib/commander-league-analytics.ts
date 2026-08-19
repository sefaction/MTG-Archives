export type LeagueAnalyticsCardInput = {
  cardName: string;
  oracleId: string | null;
  quantity: number;
  isCommander: boolean;
  section: string;
  manaValue: number | null;
  colorIdentity: unknown;
  typeLine: string | null;
  setCode: string | null;
  setName: string | null;
};

export type LeagueAnalyticsSubmissionInput = {
  id: string;
  memberId: string;
  displayName: string;
  monthNumber: number;
  monthName: string;
  result: "WIN" | "LOSS" | "DRAW";
  cards: LeagueAnalyticsCardInput[];
};

type UsageRow = {
  key: string;
  name: string;
  appearances: number;
  copies: number;
  wins: number;
  winRate: number;
};

type Composition = {
  creatures: number;
  spells: number;
  otherPermanents: number;
  lands: number;
};

const colorOrder = ["W", "U", "B", "R", "G"];

function cardKey(card: LeagueAnalyticsCardInput) {
  return card.oracleId || card.cardName.trim().toLowerCase();
}

function playableCards(cards: LeagueAnalyticsCardInput[]) {
  return cards.filter(
    (card) => card.section !== "SIDEBOARD" && card.section !== "MAYBEBOARD",
  );
}

function isLand(card: LeagueAnalyticsCardInput) {
  return card.typeLine?.toLowerCase().includes("land") ?? false;
}

function isBasicLand(card: LeagueAnalyticsCardInput) {
  const typeLine = card.typeLine?.toLowerCase() ?? "";
  return typeLine.includes("basic") && typeLine.includes("land");
}

function parseColors(value: unknown) {
  let values: unknown[] = [];
  if (Array.isArray(value)) values = value;
  else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : value.split(/[\s,;/|]+/);
    } catch {
      values = value.split(/[\s,;/|]+/);
    }
  }
  return values
    .map((item) => String(item).trim().toUpperCase())
    .flatMap((item) => (item.length > 1 ? item.split("") : [item]))
    .filter((item) => colorOrder.includes(item));
}

function colorIdentityFor(cards: LeagueAnalyticsCardInput[]) {
  const colors = new Set(
    cards
      .filter((card) => card.isCommander)
      .flatMap((card) => parseColors(card.colorIdentity)),
  );
  if (!cards.some((card) => card.isCommander)) return "Unknown";
  const identity = colorOrder.filter((color) => colors.has(color)).join("");
  return identity || "Colorless";
}

function compositionFor(cards: LeagueAnalyticsCardInput[]): Composition {
  const composition = { creatures: 0, spells: 0, otherPermanents: 0, lands: 0 };
  for (const card of cards) {
    const typeLine = card.typeLine?.toLowerCase() ?? "";
    if (typeLine.includes("land")) composition.lands += card.quantity;
    else if (typeLine.includes("creature"))
      composition.creatures += card.quantity;
    else if (typeLine.includes("instant") || typeLine.includes("sorcery"))
      composition.spells += card.quantity;
    else composition.otherPermanents += card.quantity;
  }
  return composition;
}

function usageRows(
  submissions: LeagueAnalyticsSubmissionInput[],
  selectCards: (
    cards: LeagueAnalyticsCardInput[],
  ) => LeagueAnalyticsCardInput[],
) {
  const rows = new Map<string, Omit<UsageRow, "winRate">>();
  for (const submission of submissions) {
    const cards = new Map<string, LeagueAnalyticsCardInput>();
    for (const card of selectCards(playableCards(submission.cards))) {
      const key = cardKey(card);
      const existing = cards.get(key);
      cards.set(
        key,
        existing
          ? { ...existing, quantity: existing.quantity + card.quantity }
          : card,
      );
    }
    for (const [key, card] of cards) {
      const row = rows.get(key) ?? {
        key,
        name: card.cardName,
        appearances: 0,
        copies: 0,
        wins: 0,
      };
      row.appearances += 1;
      row.copies += card.quantity;
      if (submission.result === "WIN") row.wins += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((row) => ({
    ...row,
    winRate: row.appearances ? row.wins / row.appearances : 0,
  }));
}

function summarize(submissions: LeagueAnalyticsSubmissionInput[]) {
  const composition = { creatures: 0, spells: 0, otherPermanents: 0, lands: 0 };
  const manaCurve = Array.from({ length: 8 }, (_, index) => ({
    label: index === 7 ? "7+" : String(index),
    cards: 0,
  }));
  let manaTotal = 0;
  let manaCards = 0;
  for (const submission of submissions) {
    const cards = playableCards(submission.cards);
    const deckComposition = compositionFor(cards);
    composition.creatures += deckComposition.creatures;
    composition.spells += deckComposition.spells;
    composition.otherPermanents += deckComposition.otherPermanents;
    composition.lands += deckComposition.lands;
    for (const card of cards.filter((item) => !isLand(item))) {
      if (card.manaValue === null) continue;
      const bucket = Math.min(7, Math.max(0, Math.floor(card.manaValue)));
      manaCurve[bucket].cards += card.quantity;
      manaTotal += card.manaValue * card.quantity;
      manaCards += card.quantity;
    }
  }
  const totalComposition = Object.values(composition).reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    averageManaValue: manaCards ? manaTotal / manaCards : null,
    averageLandCount: submissions.length
      ? composition.lands / submissions.length
      : null,
    manaCurve,
    composition: {
      ...composition,
      total: totalComposition,
    },
  };
}

export function buildLeagueDeckAnalytics(
  allSubmissions: LeagueAnalyticsSubmissionInput[],
  memberId?: string,
) {
  const submissions = memberId
    ? allSubmissions.filter((submission) => submission.memberId === memberId)
    : allSubmissions;
  const cards = usageRows(submissions, (items) =>
    items.filter((card) => !isBasicLand(card) && !card.isCommander),
  );
  const commanders = usageRows(submissions, (items) =>
    items.filter((card) => card.isCommander),
  );
  const colors = new Map<string, { appearances: number; wins: number }>();
  for (const submission of submissions) {
    const identity = colorIdentityFor(playableCards(submission.cards));
    const row = colors.get(identity) ?? { appearances: 0, wins: 0 };
    row.appearances += 1;
    if (submission.result === "WIN") row.wins += 1;
    colors.set(identity, row);
  }
  const colorIdentities = [...colors.entries()]
    .map(([name, row]) => ({
      name,
      ...row,
      winRate: row.appearances ? row.wins / row.appearances : 0,
    }))
    .sort(
      (a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name),
    );

  const months = [...new Set(submissions.map((item) => item.monthNumber))]
    .sort((a, b) => a - b)
    .map((monthNumber) => {
      const monthSubmissions = submissions.filter(
        (item) => item.monthNumber === monthNumber,
      );
      const summary = summarize(monthSubmissions);
      const monthColors = new Map<string, number>();
      for (const submission of monthSubmissions) {
        const identity = colorIdentityFor(playableCards(submission.cards));
        monthColors.set(identity, (monthColors.get(identity) ?? 0) + 1);
      }
      return {
        monthNumber,
        monthName: monthSubmissions[0]?.monthName ?? `Month ${monthNumber}`,
        decks: monthSubmissions.length,
        topColorIdentity:
          [...monthColors.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
          )[0]?.[0] ?? "—",
        ...summary,
      };
    });

  const sets = new Map<
    string,
    {
      setCode: string;
      setName: string;
      copies: number;
      cardKeys: Set<string>;
      months: Map<number, number>;
    }
  >();
  for (const submission of submissions) {
    for (const card of playableCards(submission.cards)) {
      if (isBasicLand(card)) continue;
      if (!card.setCode) continue;
      const key = card.setCode.toLowerCase();
      const row = sets.get(key) ?? {
        setCode: card.setCode.toUpperCase(),
        setName: card.setName || card.setCode.toUpperCase(),
        copies: 0,
        cardKeys: new Set<string>(),
        months: new Map<number, number>(),
      };
      row.copies += card.quantity;
      row.cardKeys.add(cardKey(card));
      row.months.set(
        submission.monthNumber,
        (row.months.get(submission.monthNumber) ?? 0) + card.quantity,
      );
      sets.set(key, row);
    }
  }
  const setUsage = [...sets.values()]
    .map((row) => ({
      setCode: row.setCode,
      setName: row.setName,
      copies: row.copies,
      uniqueCards: row.cardKeys.size,
      averageCopiesPerDeck: submissions.length
        ? row.copies / submissions.length
        : 0,
      monthlyAverage: months.map((month) => ({
        monthNumber: month.monthNumber,
        monthName: month.monthName,
        average: month.decks
          ? (row.months.get(month.monthNumber) ?? 0) / month.decks
          : 0,
      })),
    }))
    .sort((a, b) => b.copies - a.copies || a.setCode.localeCompare(b.setCode));

  const selectedIds = new Set(
    memberId ? [memberId] : submissions.map((item) => item.memberId),
  );
  const appearancesByCard = new Map<
    string,
    Map<string, { name: string; count: number }>
  >();
  for (const submission of allSubmissions) {
    const seen = new Set<string>();
    for (const card of playableCards(submission.cards)) {
      if (card.isCommander || isBasicLand(card)) continue;
      const key = cardKey(card);
      if (seen.has(key)) continue;
      seen.add(key);
      const byMember = appearancesByCard.get(key) ?? new Map();
      const row = byMember.get(submission.memberId) ?? {
        name: card.cardName,
        count: 0,
      };
      row.count += 1;
      byMember.set(submission.memberId, row);
      appearancesByCard.set(key, byMember);
    }
  }
  const memberNames = new Map(
    allSubmissions.map((item) => [item.memberId, item.displayName]),
  );
  const signatureCards = [...selectedIds]
    .flatMap((selectedMemberId) =>
      [...appearancesByCard.entries()].flatMap(([key, byMember]) => {
        const player = byMember.get(selectedMemberId);
        if (!player || player.count < 2) return [];
        const leagueAppearances = [...byMember.values()].reduce(
          (sum, row) => sum + row.count,
          0,
        );
        return [
          {
            key: `${selectedMemberId}-${key}`,
            memberId: selectedMemberId,
            displayName: memberNames.get(selectedMemberId) ?? "Unknown player",
            cardName: player.name,
            appearances: player.count,
            leagueAppearances,
            signatureShare: player.count / leagueAppearances,
          },
        ];
      }),
    )
    .sort(
      (a, b) =>
        b.signatureShare - a.signatureShare ||
        b.appearances - a.appearances ||
        a.cardName.localeCompare(b.cardName),
    );

  const summary = summarize(submissions);
  return {
    submissionCount: submissions.length,
    topCards: cards
      .sort(
        (a, b) =>
          b.appearances - a.appearances ||
          b.copies - a.copies ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 15),
    commanders: commanders
      .sort(
        (a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name),
      )
      .slice(0, 12),
    cardWinRates: cards
      .filter((row) => row.appearances >= 2)
      .sort(
        (a, b) =>
          b.winRate - a.winRate ||
          b.appearances - a.appearances ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 12),
    commanderWinRates: commanders
      .sort(
        (a, b) =>
          b.winRate - a.winRate ||
          b.appearances - a.appearances ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 12),
    colorIdentities,
    months,
    setUsage: setUsage.slice(0, 10),
    signatureCards: signatureCards.slice(0, memberId ? 12 : 16),
    ...summary,
  };
}
