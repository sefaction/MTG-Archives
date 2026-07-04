import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import {
  buildDeckImportResolution,
  parseDecklistText,
  resolveParsedDecklist,
} from "@/lib/deck-import";

export async function POST(request: NextRequest) {
  const user = await requireLogin();
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text : "";
  const parsed = parseDecklistText(text);
  if (body.mode === "parse") {
    return Response.json(
      buildDeckImportResolution(parsed.lines, parsed.skippedLines),
    );
  }
  const resolution = await resolveParsedDecklist(parsed, user.playerId);
  return Response.json(resolution);
}
