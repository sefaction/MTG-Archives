import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueDeckAnalytics,
  type LeagueAnalyticsSubmissionInput,
} from "../lib/commander-league-analytics";

function submission(
  id: string,
  memberId: string,
  monthNumber: number,
  result: "WIN" | "LOSS",
  cards: LeagueAnalyticsSubmissionInput["cards"],
): LeagueAnalyticsSubmissionInput {
  return {
    id,
    memberId,
    displayName: memberId === "alice" ? "Alice" : "Bob",
    monthNumber,
    monthName: monthNumber === 1 ? "January" : "February",
    result,
    cards,
  };
}

function card(
  cardName: string,
  options: Partial<LeagueAnalyticsSubmissionInput["cards"][number]> = {},
): LeagueAnalyticsSubmissionInput["cards"][number] {
  return {
    cardName,
    oracleId: cardName.toLowerCase(),
    quantity: 1,
    isCommander: false,
    section: "MAINBOARD",
    manaValue: 2,
    colorIdentity: ["U"],
    typeLine: "Creature — Wizard",
    setCode: "TST",
    setName: "Test Set",
    ...options,
  };
}

const snapshots = [
  submission("a-jan", "alice", 1, "WIN", [
    card("Blue Leader", {
      isCommander: true,
      section: "COMMANDER",
      manaValue: 4,
    }),
    card("Signature Spell", { typeLine: "Instant", manaValue: 1 }),
    card("Signature Spell", { typeLine: "Instant", manaValue: 1 }),
    card("Island", {
      quantity: 36,
      manaValue: 0,
      typeLine: "Basic Land — Island",
      setCode: "BAS",
      setName: "Basic Set",
    }),
  ]),
  submission("a-feb", "alice", 2, "LOSS", [
    card("Blue Leader", {
      isCommander: true,
      section: "COMMANDER",
      manaValue: 4,
    }),
    card("Signature Spell", { typeLine: "Instant", manaValue: 1 }),
    card("Seven Drop", { manaValue: 9 }),
    card("Island", {
      quantity: 38,
      manaValue: 0,
      typeLine: "Basic Land — Island",
      setCode: "BAS",
      setName: "Basic Set",
    }),
  ]),
  submission("b-jan", "bob", 1, "LOSS", [
    card("Green Leader", {
      isCommander: true,
      section: "COMMANDER",
      manaValue: 3,
      colorIdentity: ["G"],
    }),
    card("Shared Card", { typeLine: "Artifact" }),
    card("Forest", {
      quantity: 40,
      manaValue: 0,
      typeLine: "Basic Land — Forest",
      setCode: "BAS",
      setName: "Basic Set",
    }),
  ]),
];

test("builds overall usage, win-rate, curve, composition, and set analytics", () => {
  const stats = buildLeagueDeckAnalytics(snapshots);
  assert.equal(stats.submissionCount, 3);
  assert.equal(stats.topCards[0].name, "Signature Spell");
  assert.equal(stats.commanders[0].name, "Blue Leader");
  assert.equal(stats.commanderWinRates[0].winRate, 0.5);
  assert.equal(
    stats.colorIdentities.find((row) => row.name === "U")?.appearances,
    2,
  );
  assert.equal(stats.averageLandCount, 38);
  assert.equal(stats.manaCurve[7].cards, 1);
  assert.equal(stats.composition.spells, 3);
  assert.equal(stats.setUsage[0].setCode, "TST");
  assert.equal(
    stats.setUsage.some((row) => row.setCode === "BAS"),
    false,
  );
  assert.equal(stats.setUsage[0].monthlyAverage.length, 2);
});

test("scopes every breakdown to one player while retaining league signature context", () => {
  const stats = buildLeagueDeckAnalytics(snapshots, "alice");
  assert.equal(stats.submissionCount, 2);
  assert.deepEqual(
    stats.colorIdentities.map((row) => row.name),
    ["U"],
  );
  assert.equal(stats.averageLandCount, 37);
  assert.equal(stats.signatureCards[0].cardName, "Signature Spell");
  assert.equal(stats.signatureCards[0].displayName, "Alice");
  assert.equal(stats.signatureCards[0].signatureShare, 1);
});

test("excludes sideboards, maybeboards, commanders, and basic lands from card rankings", () => {
  const stats = buildLeagueDeckAnalytics([
    submission("one", "alice", 1, "WIN", [
      card("Leader", { isCommander: true, section: "COMMANDER" }),
      card("Side Card", { section: "SIDEBOARD" }),
      card("Maybe Card", { section: "MAYBEBOARD" }),
      card("Island", { quantity: 20, typeLine: "Basic Land — Island" }),
      card("Real Card"),
    ]),
  ]);
  assert.deepEqual(
    stats.topCards.map((row) => row.name),
    ["Real Card"],
  );
});
