import { NextRequest } from "next/server";
import { getAccessScope, requireLogin } from "@/lib/auth";
import {
  buildDeckImportResolution,
  type DeckImportResolutionPolicy,
  type DeckImportReviewLine,
  parseDecklistText,
  resolveParsedDecklist,
} from "@/lib/deck-import";
import { getDeckManagementPolicy } from "@/lib/deck-management-policy";

function cleanResolutionPolicy(value: unknown): DeckImportResolutionPolicy {
  return value === "owned-only" || value === "cheapest-only"
    ? value
    : "owned-then-cheapest";
}

export async function POST(request: NextRequest) {
  const user = await requireLogin();
  const body = await request.json().catch(() => ({}));
  const deckId = typeof body.deckId === "string" ? body.deckId : "";
  const scope = await getAccessScope(user);
  const management = deckId
    ? await getDeckManagementPolicy(deckId, user, scope?.mode === "admin")
    : null;
  if (
    deckId &&
    (!management?.deck || !management.canManage || management.locked)
  ) {
    return Response.json({ error: "Deck cannot be edited." }, { status: 403 });
  }
  const leagueId = management?.deck?.commanderLeagueDeck?.leagueId ?? null;
  const text = typeof body.text === "string" ? body.text : "";
  const parsed = parseDecklistText(text);
  if (body.mode === "parse") {
    return Response.json(
      buildDeckImportResolution(parsed.lines, parsed.skippedLines),
    );
  }
  const policy = cleanResolutionPolicy(body.policy);
  if (body.mode === "resolve-lines" && Array.isArray(body.lines)) {
    const resolution = await resolveParsedDecklist(
      body.lines as DeckImportReviewLine[],
      user.playerId,
      policy,
      leagueId,
    );
    return Response.json(resolution);
  }
  const resolution = await resolveParsedDecklist(
    parsed,
    user.playerId,
    policy,
    leagueId,
  );
  return Response.json(resolution);
}
