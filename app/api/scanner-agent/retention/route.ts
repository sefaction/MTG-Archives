import { prisma } from "@/lib/prisma";
import { readScannerJson } from "@/lib/scanner-http";
import { scannerSiteEpoch } from "@/lib/scanner-control-files";
import { eligibleScannerOriginals } from "@/lib/scanner-retention";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = await readScannerJson(request, 120000);
    const result = await eligibleScannerOriginals(prisma, request.headers.get("authorization"),
      input, await scannerSiteEpoch());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scanner retention check unavailable; keep local originals" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
