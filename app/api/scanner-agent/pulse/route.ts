import { prisma } from "@/lib/prisma";
import { recordScannerPulse } from "@/lib/scanner-store";
import { readScannerJson } from "@/lib/scanner-http";
import { scannerConnectionError } from "@/lib/scanner-errors";
export async function POST(request: Request) {
  try {
    return Response.json(await recordScannerPulse(prisma, request.headers.get("authorization"), await readScannerJson(request, 65536)),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return scannerConnectionError(error); }
}
