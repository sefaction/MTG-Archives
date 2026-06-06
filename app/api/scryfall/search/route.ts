import { NextRequest } from "next/server";
import { requireLogin } from "@/lib/auth";
import { searchLocalThenScryfallCards } from "@/lib/card-import";

export async function GET(request: NextRequest) {
  await requireLogin();
  const q = request.nextUrl.searchParams.get("q") || "";
  const result = await searchLocalThenScryfallCards(q);
  return Response.json({
    data: result.cards.slice(0, 25),
    message: result.message,
  });
}
