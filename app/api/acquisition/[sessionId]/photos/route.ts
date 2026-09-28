import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import {
  beginAcquisitionPhoto,
  finalizeAcquisitionPhoto,
  getAcquisitionProgress,
} from "@/lib/acquisition-store";
import {
  inspectAcquisitionPhoto,
  readBoundedPhotoBody,
  writeAcquisitionPhotoBytes,
} from "@/lib/acquisition-files";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await params;
    const query = new URL(request.url).searchParams,
      slotId = query.get("slot") ?? "";
    const state = await getAcquisitionProgress(prisma, actor, sessionId);
    if (!state.slots.some((s) => s.id === slotId))
      throw new Error("Capture slot unavailable");
    const bytes = await readBoundedPhotoBody(request);
    const metadata = await inspectAcquisitionPhoto(
      bytes,
      request.headers.get("content-type") ?? "",
    );
    const photo = await beginAcquisitionPhoto(prisma, actor, sessionId, {
      slotId,
      uploadKey: query.get("key") ?? "",
      generation: Number(query.get("generation")),
      replacePending: query.get("replace") === "1",
      metadata,
    });
    // An acknowledged upload replay must not recreate expired committed bytes.
    // READY already records durable receipt; only unfinished uploads write files.
    let ready = photo;
    if (!photo.ready) {
      await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
      ready = await finalizeAcquisitionPhoto(
        prisma,
        actor,
        sessionId,
        photo.id,
      );
    }
    return Response.json(
      { id: ready.id, digest: ready.digest, ready: ready.ready },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
