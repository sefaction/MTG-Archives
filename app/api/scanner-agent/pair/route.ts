import { prisma } from "@/lib/prisma";
import { claimScannerPairing } from "@/lib/scanner-store";
import { readScannerJson } from "@/lib/scanner-http";
import { scannerConnectionError } from "@/lib/scanner-errors";
export async function POST(request: Request) {
  try {
    return Response.json(await claimScannerPairing(prisma, await readScannerJson(request, 4096)),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return scannerConnectionError(error); }
}
