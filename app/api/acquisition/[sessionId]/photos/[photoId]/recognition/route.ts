import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getAcquisitionPhoto } from "@/lib/acquisition-store";
import { acquisitionRecognitionJobs } from "@/lib/acquisition-recognition-jobs";
import { CATALOG_RECONCILIATION_STAGE } from "@/lib/acquisition-catalog-status";
import { VISUAL_STAGE } from "@/lib/acquisition-visual";
import { PRINTING_STAGE } from "@/lib/acquisition-printing";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string; photoId: string }> },
) {
  try {
    const { sessionId, photoId } = await context.params;
    const photo = await getAcquisitionPhoto(
      prisma,
      await acquisitionActor(),
      sessionId,
      photoId,
    );
    const jobs = await prisma.acquisitionProcessingJob.findMany({
      where: {
        runId: photo.runId,
        artifact: { sourceId: photo.id },
        stage: {
          in: [
            "photo-recognition-v1",
            CATALOG_RECONCILIATION_STAGE,
            VISUAL_STAGE,
            PRINTING_STAGE,
          ],
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 16,
      select: {
        id: true,
        input: true,
        status: true,
        stage: true,
        output: true,
        candidateRevision: true,
        candidate: { select: { revision: true, excluded: true } },
      },
    });
    const current = jobs.filter(
      (j) =>
        j.candidateRevision === j.candidate.revision &&
        !j.candidate.excluded,
    );
    const {evidence} = acquisitionRecognitionJobs(current,
      process.env.ACQUISITION_VISUAL_ENABLED === "1", process.env.ACQUISITION_PRINTING_ENABLED === "1");
    return Response.json(
      evidence,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
