import { prisma } from "@/lib/prisma";
import { readBoundedPhotoBody } from "@/lib/acquisition-files";
import { scannerSiteEpoch } from "@/lib/scanner-control-files";
import { authorizeScannerTransfer, receiveScannerImage } from "@/lib/scanner-runs";
import { scannerRunError, ScannerRequestError } from "@/lib/scanner-errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const header = request.headers.get("x-mtg-scanner");
    if (!header || header.length > 4096) throw new ScannerRequestError(header ? 413 : 400);
    let metadata: unknown;
    try { metadata = JSON.parse(header); } catch { throw new ScannerRequestError(400); }
    const authorization = request.headers.get("authorization"),
      epoch = await scannerSiteEpoch();
    await authorizeScannerTransfer(prisma, authorization, metadata, epoch);
    const bytes = await readBoundedPhotoBody(request);
    return Response.json(await receiveScannerImage(prisma, authorization, metadata, epoch, bytes,
      request.headers.get("content-type") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return scannerRunError(error); }
}
