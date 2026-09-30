import type { PrismaClient } from "@prisma/client";
import { getAcquisitionSession } from "./acquisition-store";
import { getScannerBatch } from "./scanner-runs";
import { scannerSettingsSchema } from "./scanner-run-protocol";
import type { StorageLocation } from "./storage-sections";

export async function scannerContinuation(db: PrismaClient, userId: string, runId: string) {
  const run = await getScannerBatch(db, userId, runId);
  if (!run.reconciliation || !["DRAINED", "ERROR", "CANCELLED_BEFORE_START"].includes(run.status))
    throw new Error("Previous scanner batch must settle first");
  const state = await getAcquisitionSession(db, { userId, adminMode: false }, run.sessionId);
  return { locationId: state.session.placement.locationId, section: state.session.placement.section,
    defaults: state.defaults, scanner: { agentId: run.agentId, deviceId: run.deviceId,
      loadedCount: null, operatorLoadedSimplexFronts: true as const,
      settings: scannerSettingsSchema.parse(run.settings) } };
}
export type ScannerContinuation = Awaited<ReturnType<typeof scannerContinuation>>;

// Resolve the suggestion against this page's freshly authorized locations.
// It is a form preference, never a copied capacity/ownership snapshot or START.
export function currentScannerContinuation(previous: ScannerContinuation, locations: StorageLocation[]) {
  const location = locations.find(l => l.id === previous.locationId);
  if (!location) return { setup: null, message: "Previous destination is unavailable. Choose a destination and scanner below." };
  const section = previous.section;
  if (section && !location.sections.some(s => s.name === section) && !location.defaultSectionNames?.includes(section))
    return { setup: { ...previous, section: "" }, message: "Previous section is unavailable. Check the destination before starting." };
  return { setup: previous, message: "Previous destination, scanner settings and batch defaults are ready. Check the available space, load cards, then start." };
}
