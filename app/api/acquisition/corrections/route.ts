import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getCorrectionLibrary } from "@/lib/acquisition-correction-access";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const owner = z.string().min(1).max(200).parse(query.get("owner"));
    return Response.json(await getCorrectionLibrary(prisma, await acquisitionActor(request), owner, query.get("cursor") ?? undefined),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return acquisitionError(error); }
}
