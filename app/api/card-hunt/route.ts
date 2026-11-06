import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCardHunt, CardHuntError } from "@/lib/card-hunt-service";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const headers = {"Cache-Control": "private, no-store"};
  if (!user) return Response.json({error: "Sign in to hunt cards."}, {status: 401, headers});
  let input: unknown;
  try {
    // Bound the body itself as well as the parsed list; clients cannot send an unbounded JSON value.
    const reader = request.body?.getReader();
    if (!reader) throw new CardHuntError("Choose a deck or paste a card list.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128_000) throw new CardHuntError("The card list is too large.", 413);
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return Response.json({error: error instanceof CardHuntError ? error.message : "The hunt request could not be read."},
      {status: error instanceof CardHuntError ? error.status : 400, headers});
  }
  try {
    // One consistent inventory/reservation snapshot; this is strictly a read-only plan.
    const result = await prisma.$transaction(tx => buildCardHunt(tx, user, input), {
      isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 30_000,
    });
    return Response.json(result, {headers});
  } catch (error) {
    if (error instanceof CardHuntError)
      return Response.json({error: error.message}, {status: error.status, headers});
    console.error("Card Hunt could not be prepared", error);
    return Response.json({error: "The hunt could not be prepared. Please try again."}, {status: 500, headers});
  }
}
