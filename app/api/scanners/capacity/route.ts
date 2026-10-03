import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { scannerTransaction } from "@/lib/scanner-store";
import { readScannerCapacity } from "@/lib/scanner-capacity";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await acquisitionActor(request), params = new URL(request.url).searchParams;
    const locationId = z.string().min(1).max(200).parse(params.get("location"));
    const section = z.string().max(100).parse(params.get("section") ?? "");
    const capacity = await scannerTransaction(prisma, async tx => {
      const user = await tx.user.findUnique({ where: { id: actor.userId }, include: { player: true } });
      if (!user?.isActive || user.forcePasswordChange || !user.player?.active) throw new Error("Destination unavailable");
      return readScannerCapacity(tx, { locationId, section, ownerPlayerId: user.player.id });
    });
    return Response.json({ locationId, section, remaining: capacity.remaining,
      pendingSection: capacity.pendingSection, pendingTotal: capacity.pendingTotal }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return acquisitionError(error); }
}
