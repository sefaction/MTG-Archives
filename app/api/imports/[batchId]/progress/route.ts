import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessImportBatch, requireLogin } from "@/lib/auth";
import { calculateImportProgress } from "@/lib/import-progress";
import {
  getImportResolutionJobConfig,
  getLatestImportResolutionJob,
  markStaleImportResolutionJobs,
  serializeImportResolutionJob,
} from "@/lib/import-resolution-job";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const user = await requireLogin();
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      status: true,
      totalRows: true,
      matchedRows: true,
      skippedRows: true,
      warningRows: true,
      errorRows: true,
      createdAt: true,
      items: { select: { status: true } },
      selectedPlayerId: true,
    },
  });
  if (!batch)
    return Response.json(
      { success: false, message: "Import batch not found." },
      { status: 404 },
    );
  if (!canAccessImportBatch(user, batch))
    return Response.json(
      { success: false, message: "Not authorized for this import batch." },
      { status: 403 },
    );

  await markStaleImportResolutionJobs(
    prisma,
    batch.id,
    getImportResolutionJobConfig(),
  );
  const resolutionJob = await getLatestImportResolutionJob(prisma, batch.id);
  const progress = calculateImportProgress({
    batchStatus: batch.status,
    itemStatuses: batch.items.map((item) => item.status),
  });
  return Response.json({
    success: true,
    batch: {
      id: batch.id,
      status: batch.status,
      totalRows: batch.totalRows,
      matchedRows: batch.matchedRows,
      skippedRows: batch.skippedRows,
      warningRows: batch.warningRows,
      errorRows: batch.errorRows,
      createdAt: batch.createdAt,
    },
    progress,
    resolutionJob: serializeImportResolutionJob(resolutionJob),
  });
}
