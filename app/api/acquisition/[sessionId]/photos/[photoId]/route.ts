import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getAcquisitionPhoto } from "@/lib/acquisition-store";
import { readAcquisitionPhotoBytes } from "@/lib/acquisition-files";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; photoId: string }> },
) {
  try {
    const { sessionId, photoId } = await params;
    const photo = await getAcquisitionPhoto(
      prisma,
      await acquisitionActor(request),
      sessionId,
      photoId,
    );
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    let digest = photo.digest;
    if (preview) {
      const job = await prisma.acquisitionProcessingJob.findFirst({
        where: {
          runId: photo.runId,
          artifact: { sourceId: photo.id },
          stage: "photo-canonical-v1",
          status: "COMPLETE",
        },
      });
      if (!job) throw new Error("Photo preview unavailable");
      digest = z
        .object({ previewDigest: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(job.output).previewDigest;
    }
    const bytes = await readAcquisitionPhotoBytes(
      photo.id,
      preview ? "preview" : "raw",
      digest,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": preview ? "image/jpeg" : photo.mediaType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="card-photo"',
      },
    });
  } catch (error) {
    return acquisitionError(error);
  }
}
