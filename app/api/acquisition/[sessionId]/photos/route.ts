import { prisma } from "@/lib/prisma";
import { acquisitionImageInputKindSchema } from "@/lib/acquisition-image-input";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import {acquisitionUploadFailureDiagnostic, type AcquisitionUploadPhase} from "@/lib/acquisition-upload";
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
  let phase: AcquisitionUploadPhase="AUTHORIZE";
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await params;
    const query = new URL(request.url).searchParams,
      slotId = query.get("slot") ?? "";
    phase="CHECK_SLOT";
    const state = await getAcquisitionProgress(prisma, actor, sessionId);
    if (!state.slots.some((s) => s.id === slotId))
      throw new Error("Capture slot unavailable");
    phase="READ_BODY";
    const bytes = await readBoundedPhotoBody(request);
    const inputKind = acquisitionImageInputKindSchema.parse(query.get("inputKind") ?? "PHOTO");
    phase="INSPECT";
    const metadata = await inspectAcquisitionPhoto(
      bytes,
      request.headers.get("content-type") ?? "",
    );
    phase="BEGIN";
    const photo = await beginAcquisitionPhoto(prisma, actor, sessionId, {
      slotId,
      uploadKey: query.get("key") ?? "",
      generation: Number(query.get("generation")),
      replacePending: query.get("replace") === "1",
      metadata,
      inputKind,
    });
    // An acknowledged upload replay must not recreate expired committed bytes.
    // READY already records durable receipt; only unfinished uploads write files.
    let ready = photo;
    if (!photo.ready) {
      phase="WRITE";
      await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
      phase="FINALIZE";
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
    // Fixed classifications only; never print error messages, stacks, metadata,
    // request bodies, paths, identities or credentials into shared service logs.
    console.warn(JSON.stringify(acquisitionUploadFailureDiagnostic(error,phase)));
    return acquisitionError(error);
  }
}
