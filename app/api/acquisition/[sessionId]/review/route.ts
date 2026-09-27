import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import {
  getAcquisitionCardReview,
  saveAcquisitionReview,
  searchAcquisitionPrintings,
} from "@/lib/acquisition-store";
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await context.params;
    const query = new URL(request.url).searchParams;
    const result = query.has("photoId")
      ? await getAcquisitionCardReview(
          prisma,
          actor,
          sessionId,
          query.get("photoId")!,
        )
      : await searchAcquisitionPrintings(prisma, actor, sessionId, {
          query: query.get("query") ?? "",
          set: query.get("set") ?? "",
          number: query.get("number") ?? "",
        });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acquisitionError(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const result = await saveAcquisitionReview(
      prisma,
      await acquisitionActor(request),
      (await context.params).sessionId,
      await request.json(),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acquisitionError(error);
  }
}
