import { Prisma, type PrismaClient, type AcquisitionProcessingJob } from "@prisma/client";

type Parents = Pick<AcquisitionProcessingJob, "runId" | "artifactId" | "candidateId">;

// Source was read from a constrained job row. Only confirmed disappearance of
// one of its referenced parents explains a cleanup race after that read.
export async function admitAcquisitionHandoff(
  db: PrismaClient,
  source: Parents,
  create: () => Promise<{ count: number }>,
): Promise<{ count: number }> {
  try {
    return await create();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2003")
      throw error;
    const parents = await Promise.all([
      db.acquisitionRun.findUnique({ where: { id: source.runId }, select: { id: true } }),
      db.acquisitionArtifact.findUnique({ where: { id: source.artifactId }, select: { id: true } }),
      db.acquisitionCandidate.findUnique({ where: { id: source.candidateId }, select: { id: true } }),
    ]);
    if (parents.some((parent) => !parent)) return { count: 0 };
    throw error;
  }
}
