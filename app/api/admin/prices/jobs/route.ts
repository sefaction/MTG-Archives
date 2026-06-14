import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "@/lib/auth";
import {
  createPriceImportJob,
  isPriceImportJobType,
  listPriceImportJobs,
} from "@/lib/price-import-jobs";

export async function GET() {
  await requireAdminMode();
  const jobs = await listPriceImportJobs(undefined, 20);
  return NextResponse.json({ ok: true, jobs });
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
