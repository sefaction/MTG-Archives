import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  importMtgjsonPrices,
  type MtgjsonPriceImportKind,
} from "@/lib/mtgjson-prices";

export async function POST(request: NextRequest) {
  await requireAdminMode();
  const body = await request.json().catch(() => ({}));
  const kind: MtgjsonPriceImportKind =
    body?.kind === "history" ? "history" : "today";
  try {
    const report = await importMtgjsonPrices(prisma, kind);
    return NextResponse.json({ ok: true, report });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.message || "MTGJSON price import failed."),
      },
      { status: 500 },
    );
  }
}
