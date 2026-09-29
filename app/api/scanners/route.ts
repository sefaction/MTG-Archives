import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { createScannerPairing, listScannerAgents, revokeScannerAgent } from "@/lib/scanner-store";
import { readScannerJson } from "@/lib/scanner-http";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const actor = await acquisitionActor();
    return Response.json({ agents: await listScannerAgents(prisma, actor.userId) }, { headers });
  } catch (error) { return acquisitionError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await acquisitionActor(request);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("pair") }).strict(),
      z.object({ action: z.literal("revoke"), agentId: z.string().uuid() }).strict(),
    ]).parse(await readScannerJson(request, 4096));
    if (input.action === "pair") return Response.json(await createScannerPairing(prisma, actor.userId), { headers });
    await revokeScannerAgent(prisma, actor.userId, input.agentId);
    return Response.json({ revoked: true }, { headers });
  } catch (error) { return acquisitionError(error); }
}
