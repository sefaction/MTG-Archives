import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  handoffActor,
  handoffError,
  handoffJson,
} from "@/lib/card-handoff-api";
import { changeBulkLocation } from "@/lib/bulk-locations";
export async function POST(request: Request) {
  try {
    const actor = await handoffActor(request),
      raw = await handoffJson(request, 10000);
    const result = await changeBulkLocation(prisma, actor.userId, raw);
    for (const path of ["/locations", "/inventory", "/card-hunt"])
      revalidatePath(path);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handoffError(error);
  }
}
