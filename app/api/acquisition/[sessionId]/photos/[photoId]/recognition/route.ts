import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { getAcquisitionPhoto } from "@/lib/acquisition-store";
import { acquisitionRecognitionDto } from "@/lib/acquisition-recognition-dto";

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
        stage: "photo-recognition-v1",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        status: true,
        output: true,
        candidateRevision: true,
        candidate: { select: { revision: true, excluded: true } },
      },
    });
    const job = jobs.find(
      (j) =>
        j.candidateRevision === j.candidate.revision && !j.candidate.excluded,
    );
    return Response.json(
      acquisitionRecognitionDto(job?.status ?? "WAITING", job?.output),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
