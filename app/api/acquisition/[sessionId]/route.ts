import { prisma } from "@/lib/prisma";
import {
  acquisitionActor,
  acquisitionError,
  acquisitionProgressDto,
} from "@/lib/acquisition-api";
import {
  getAcquisitionProgress,
  executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot,
} from "@/lib/acquisition-store";
import { z } from "zod";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return Response.json(
      acquisitionProgressDto(
        await getAcquisitionProgress(
          prisma,
          await acquisitionActor(request),
          (await context.params).sessionId,
        ),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await context.params;
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("reserve"),
            requestKey: z.string().uuid(),
          })
          .strict(),
        z
          .object({
            action: z.literal("control"),
            requestKey: z.string().uuid(),
            revision: z.number().int().nonnegative(),
            command: z.enum(["START", "STOP", "PAUSE", "RESUME", "CANCEL"]),
          })
          .strict(),
      ])
      .parse(await request.json());
    if (input.action === "reserve")
      return Response.json(
        await reserveAcquisitionCaptureSlot(
          prisma,
          actor,
          sessionId,
          input.requestKey,
        ),
      );
    await executeAcquisitionCommand(prisma, actor, sessionId, input);
    return Response.json(
      acquisitionProgressDto(
        await getAcquisitionProgress(prisma, actor, sessionId),
      ),
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
