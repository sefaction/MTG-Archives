import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "@/lib/auth";
import {
  createPriceImportJob,
  type PriceImportJobType,
} from "@/lib/price-import-jobs";

export async function POST(request: NextRequest) {
  const user = await requireAdminMode();
  const body = await request.json().catch(() => ({}));
  const type: PriceImportJobType =
    body?.kind === "map"
      ? "map_mtgjson_cards"
      : body?.kind === "history"
        ? "import_prices_history"
        : "import_prices_today";
  const { job, existing } = await createPriceImportJob(type, user.id);
  return NextResponse.json({ ok: true, jobId: job.id, job, existing });
}
