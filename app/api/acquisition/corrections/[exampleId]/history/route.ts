import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getCorrectionReviewHistory } from "@/lib/acquisition-correction-history";
import { z } from "zod";
export const runtime = "nodejs";
type Context = { params: Promise<{ exampleId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const query = new URL(request.url).searchParams;
    const owner = z.string().min(1).max(200).parse(query.get("owner"));
    return Response.json(await getCorrectionReviewHistory(prisma, await acquisitionActor(request), owner,
      (await context.params).exampleId, query.get("cursor") ?? undefined),
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return acquisitionError(error); }
}
