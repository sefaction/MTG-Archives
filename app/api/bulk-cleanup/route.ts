import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  handoffActor,
  handoffError,
  handoffJson,
} from "@/lib/card-handoff-api";
import { HandoffError } from "@/lib/card-handoffs";
import { bulkScopeInput, pullBrowseInput } from "@/lib/pull-scope";
import { getBulkContext } from "@/lib/bulk-cleanup-service";
import {
  performBulkAction,
  saveBulkSettings,
} from "@/lib/bulk-cleanup-actions";
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new HandoffError("Sign in to use personal cleanup.", 401);
    const query = new URL(request.url).searchParams;
    const result = await getBulkContext(prisma, user.id, {
      batchId: query.get("batchId") || undefined,
      page: Number(query.get("page")) || 1,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handoffError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await handoffActor(request),
      raw = await handoffJson(request, 500000);
    const result =
      raw?.action === "PLAN"
        ? await getBulkContext(prisma, actor.userId, {
            page: Number(raw.page) || 1,
            scope: bulkScopeInput.parse(raw.scope ?? {}),
            browse: pullBrowseInput.parse(raw.browse ?? {}),
          })
        : raw?.action === "SETTINGS"
          ? await saveBulkSettings(prisma, actor.userId, raw)
          : await performBulkAction(prisma, actor.userId, raw);
    if (raw?.action !== "PLAN")
      for (const path of [
        "/settings",
        "/card-hunt",
        "/inventory",
        "/inventory/handoffs",
        "/locations",
        "/imports/scan",
      ])
        revalidatePath(path);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handoffError(error);
  }
}
