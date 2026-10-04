import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { manageAcquisitionBatch } from "@/lib/acquisition-batch-lifecycle";
export async function POST(request: Request, context: {params: Promise<{sessionId: string}>}) {
  try {
    const actor = await acquisitionActor(request), {sessionId} = await context.params;
    const body = await request.json();
    const result = await manageAcquisitionBatch(prisma, actor, sessionId, body.action);
    return Response.json(result, {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return acquisitionError(error); }
}
