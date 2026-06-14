import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mapMtgjsonCards, type MtgjsonPriceImportKind } from "@/lib/mtgjson-prices";

export async function POST(request: NextRequest) {
  await requireAdminMode();
  const body = await request.json().catch(() => ({}));
  if (body?.kind === "map") {
    const report = await mapMtgjsonCards(prisma);
    return NextResponse.json({ ok: true, report });
  }
  const kind: MtgjsonPriceImportKind =
    body?.kind === "history" ? "history" : "today";
  return NextResponse.json(
    {
      ok: false,
      kind,
      error:
        "Large MTGJSON price imports must be run with the streaming CLI importer from the app container.",
      command:
        kind === "history"
          ? "npm run prices:import:history"
          : "npm run prices:import:today",
    },
    { status: 400 },
  );
}
