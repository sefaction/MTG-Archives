import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import {
  previewAcquisitionCommit,
  commitAcquisitionCards,
} from "@/lib/acquisition-commit-service";
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await context.params;
    const body = await request.json();
    if (!body || !["preview", "commit"].includes(body.action))
      throw new Error("Choose preview or commit");
    const { action, ...input } = body;
    const result =
      action === "preview"
        ? await previewAcquisitionCommit(prisma, actor, sessionId, input)
        : await commitAcquisitionCards(prisma, actor, sessionId, input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acquisitionError(error);
  }
}
