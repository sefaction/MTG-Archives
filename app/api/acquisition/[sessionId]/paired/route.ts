import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import {
  readPairedScanBatch,
  searchPairedCatalog,
} from "@/lib/paired-scan-service";
import { confirmPairedScan } from "@/lib/paired-scan-review";
import { recoverPairedScan } from "@/lib/paired-scan-recovery";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await context.params,
      q = new URL(request.url).searchParams;
    return Response.json(
      q.has("query")
        ? await searchPairedCatalog(prisma, actor, sessionId, q.get("query"))
        : await readPairedScanBatch(
            prisma,
            actor,
            sessionId,
            q.get("page") ?? 0,
          ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return acquisitionError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await acquisitionActor(request),
      { sessionId } = await context.params,
      body = await request.json();
    const result =
      body.action === "confirm"
        ? await confirmPairedScan(
            prisma,
            actor,
            sessionId,
            (({ action: _action, ...input }) => input)(body),
          )
        : await recoverPairedScan(prisma, actor, sessionId, body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return acquisitionError(error);
  }
}
