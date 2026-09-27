import { prisma } from "@/lib/prisma";
import {
  acquisitionActor,
  acquisitionError,
  acquisitionProgressDto,
} from "@/lib/acquisition-api";
import {
  createAcquisitionSession,
  executeAcquisitionCommand,
  getAcquisitionProgress,
} from "@/lib/acquisition-store";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const actor = await acquisitionActor(request);
    const input = z
      .object({
        requestKey: z.string().uuid(),
        locationId: z.string().min(1),
        section: z.string().max(100),
        quantity: z.number().int().min(1).max(2147483647).nullable(),
      })
      .strict()
      .parse(await request.json());
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: input.locationId },
    });
    if (!location) throw new Error("Capture destination unavailable");
    const capture = await createAcquisitionSession(prisma, actor, {
      requestKey: input.requestKey,
      ownerPlayerId: location.ownerPlayerId,
      locationId: location.id,
      section: input.section,
      policy:
        input.quantity === null
          ? { kind: "FILL" }
          : { kind: "MANUAL", quantity: input.quantity },
      run: {
        providerId: "phone-photo-v1",
        runId: input.requestKey,
        enforcement: "EXACT_BEFORE_NEXT_ITEM",
        controls: ["STOP", "CANCEL", "PAUSE", "RESUME"],
      },
    });
    await executeAcquisitionCommand(prisma, actor, capture.session.id, {
      requestKey: "initial-start",
      revision: 0,
      command: "START",
    });
    return Response.json(
      acquisitionProgressDto(
        await getAcquisitionProgress(prisma, actor, capture.session.id),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
