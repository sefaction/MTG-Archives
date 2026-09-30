import { prisma } from "@/lib/prisma";
import { recordScannerPulse } from "@/lib/scanner-store";
import { readScannerJson } from "@/lib/scanner-http";
export async function POST(request: Request) {
  try {
    return Response.json(await recordScannerPulse(prisma, request.headers.get("authorization"), await readScannerJson(request, 65536)),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scanner connection unavailable" },
      { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
