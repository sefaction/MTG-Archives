import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getAcquisitionPhoto } from "@/lib/acquisition-store";
import { acquisitionRecognitionDto } from "@/lib/acquisition-recognition-dto";
import { CATALOG_RECONCILIATION_STAGE } from "@/lib/acquisition-catalog-status";
import { VISUAL_STAGE } from "@/lib/acquisition-visual";

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
          ],
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 16,
      select: {
        status: true,
        stage: true,
        output: true,
        candidateRevision: true,
        candidate: { select: { revision: true, excluded: true } },
      },
    });
    const job = jobs.find(
      (j) =>
        j.stage !== VISUAL_STAGE &&
        j.candidateRevision === j.candidate.revision &&
        !j.candidate.excluded,
    );
    const visual = jobs.find(
      (j) =>
        j.stage === VISUAL_STAGE &&
        j.candidateRevision === j.candidate.revision &&
        !j.candidate.excluded,
    );
    const visualStatus =
      visual?.status ??
      (process.env.ACQUISITION_VISUAL_ENABLED === "1" ? "WAITING" : undefined);
    return Response.json(
      acquisitionRecognitionDto(
        job?.status ?? "WAITING",
        job?.output,
        visualStatus,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
