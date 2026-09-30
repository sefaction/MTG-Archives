import { prisma } from "@/lib/prisma";
import { readBoundedPhotoBody } from "@/lib/acquisition-files";
import { scannerSiteEpoch } from "@/lib/scanner-control-files";
import { authorizeScannerTransfer, receiveScannerImage } from "@/lib/scanner-runs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const header = request.headers.get("x-mtg-scanner");
    if (!header || header.length > 4096) throw new Error("Scanner metadata unavailable");
    const metadata: unknown = JSON.parse(header), authorization = request.headers.get("authorization"),
      epoch = await scannerSiteEpoch();
    await authorizeScannerTransfer(prisma, authorization, metadata, epoch);
    const bytes = await readBoundedPhotoBody(request);
    return Response.json(await receiveScannerImage(prisma, authorization, metadata, epoch, bytes,
      request.headers.get("content-type") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scanner upload unavailable; original retained by helper" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
