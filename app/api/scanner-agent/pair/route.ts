import { prisma } from "@/lib/prisma";
import { claimScannerPairing } from "@/lib/scanner-store";
import { readScannerJson } from "@/lib/scanner-http";
export async function POST(request: Request) {
  try {
    return Response.json(await claimScannerPairing(prisma, await readScannerJson(request, 4096)),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scanner connection unavailable" },
      { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
