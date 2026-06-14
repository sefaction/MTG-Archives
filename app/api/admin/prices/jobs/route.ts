import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "@/lib/auth";
import {
  createPriceImportJob,
  isPriceImportJobType,
  isPriceWorkerHeartbeatFresh,
  listPriceImportJobs,
  listPriceWorkerHeartbeats,
} from "@/lib/price-import-jobs";

export async function GET() {
  await requireAdminMode();
  const [jobs, heartbeats] = await Promise.all([
    listPriceImportJobs(undefined, 20),
    listPriceWorkerHeartbeats(undefined, 5),
  ]);
  return NextResponse.json({
    ok: true,
    jobs,
    worker: {
      online: isPriceWorkerHeartbeatFresh(heartbeats[0]),
      heartbeats,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await requireAdminMode();
  const body = await request.json().catch(() => ({}));
  if (!isPriceImportJobType(body?.type)) {
    return NextResponse.json(
      { ok: false, error: "Invalid price import job type." },
      { status: 400 },
    );
  }
  const { job, existing } = await createPriceImportJob(body.type, user.id);
  return NextResponse.json({ ok: true, jobId: job.id, job, existing });
}
