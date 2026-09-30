import { prisma } from "@/lib/prisma";
import { readScannerJson } from "@/lib/scanner-http";
import { scannerSiteEpoch } from "@/lib/scanner-control-files";
import { claimScannerRun, finishScannerRun, pollScannerRun, reportScannerPreflightProblem } from "@/lib/scanner-runs";
import { scannerRunClaimSchema, scannerRunFinishSchema, scannerPreflightReportSchema } from "@/lib/scanner-run-protocol";
import { z } from "zod";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("poll"), version: z.literal(1) }).strict(),
  scannerRunClaimSchema.extend({ action: z.literal("claim") }).strict(),
  scannerRunFinishSchema.extend({ action: z.literal("finish") }).strict(),
  scannerPreflightReportSchema.extend({ action: z.literal("preflight") }).strict(),
]);
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = schema.parse(await readScannerJson(request, 16384)),
      authorization = request.headers.get("authorization"), epoch = await scannerSiteEpoch();
    const { action, ...value } = input;
    const result = action === "poll" ? await pollScannerRun(prisma, authorization, epoch) :
      action === "preflight" ? await reportScannerPreflightProblem(prisma, authorization, value, epoch) :
      action === "claim" ? await claimScannerRun(prisma, authorization, value, epoch) :
        await finishScannerRun(prisma, authorization, value, epoch);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scanner run unavailable; retained originals require review or retry" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
