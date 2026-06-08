import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import { parseDecklistText, resolveParsedDecklist } from "@/lib/deck-import";

export async function POST(request: NextRequest) {
  const user = await requireLogin();
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text : "";
  const parsed = parseDecklistText(text);
  const resolution = await resolveParsedDecklist(parsed, user.playerId);
  return Response.json(resolution);
}
