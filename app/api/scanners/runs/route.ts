import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError, acquisitionProgressDto } from "@/lib/acquisition-api";
import { getAcquisitionProgress } from "@/lib/acquisition-store";
import { readScannerJson } from "@/lib/scanner-http";
import { scannerSiteEpoch } from "@/lib/scanner-control-files";
import { createScannerBatch, getScannerBatch, findScannerBatchCreation, stopScannerBatch, reconcileScannerBatch } from "@/lib/scanner-runs";
import { scannerBatchSchema, scannerReconcileSchema } from "@/lib/scanner-run-protocol";
import { z } from "zod";
const schema = z.discriminatedUnion("action", [
  scannerBatchSchema.extend({ action: z.literal("create") }).strict(),
  z.object({ action: z.literal("stop"), runId: z.string().uuid() }).strict(),
  scannerReconcileSchema.extend({ action: z.literal("reconcile") }).strict(),
]);
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await acquisitionActor(request), params = new URL(request.url).searchParams;
    if (params.has("request")) {
      const state = await findScannerBatchCreation(prisma, actor, z.string().uuid().parse(params.get("request")));
      return Response.json({ found: !!state, progress: state ? acquisitionProgressDto(state) : null },
        { headers: { "Cache-Control": "no-store" } });
    }
    const runId = z.string().uuid().parse(params.get("run"));
    return Response.json(await getScannerBatch(prisma, actor.userId, runId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return acquisitionError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await acquisitionActor(request), input = schema.parse(await readScannerJson(request, 4096));
    const { action, ...value } = input;
    if (action === "create") {
      const run = await createScannerBatch(prisma, actor, value, await scannerSiteEpoch());
      return Response.json(acquisitionProgressDto(await getAcquisitionProgress(prisma, actor, run.sessionId)),
        { headers: { "Cache-Control": "no-store" } });
    }
    const result = action === "stop" ? await stopScannerBatch(prisma, actor.userId, input.runId) :
      await reconcileScannerBatch(prisma, actor.userId, value);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return acquisitionError(error); }
}
