import { Nav } from "@/components/Nav";
import { ImportTaskNav } from "@/components/ImportTaskNav";
import { ScannerConnections } from "@/components/ScannerConnections";
import { AcquisitionCapture } from "@/components/AcquisitionCapture";
import { requireLogin, getAccessScope } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorageLocations } from "@/lib/storage-summary";
import { scannerContinuation, currentScannerContinuation, type ScannerContinuation } from "@/lib/scanner-continuation";
export const dynamic = "force-dynamic";
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; input?: string; continue?: string }>;
}) {
  const user = await requireLogin(),
    scope = await getAccessScope(user);
  const owner =
    scope?.mode === "admin"
      ? {}
      : { ownerPlayerId: user.playerId ?? "__no_owner__" };
  const [locations, recent] = await Promise.all([
    prisma.inventoryLocation.findMany({
      where: { ...owner, active: true, systemManaged: false, kind: "NORMAL" },
      orderBy: { name: "asc" },
    }),
    prisma.acquisitionSession.findMany({
      where: { ...owner, trashedAt: null, deletedAt: null, run: { providerId: { in: ["phone-photo-v1", "windows-scanner-simplex-v1"] } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, batchNumber: true, phase: true },
    }),
  ]);
  const params = await searchParams;
  const photoInput = params.input === "camera" || params.input === "photos" ? params.input : undefined;
  const initialBatch = params.batch ?? "";
  const storage = await getStorageLocations(prisma, locations);
  let initialSetup: ScannerContinuation | null = null, setupMessage = "";
  if (!initialBatch && !photoInput && params.continue) {
    try {
      const current = currentScannerContinuation(await scannerContinuation(prisma, user.id, params.continue), storage);
      initialSetup = current.setup; setupMessage = current.message;
    } catch { setupMessage = "Previous batch settings could not be reused. Choose a destination and scanner below."; }
  }
  return (
    <main className="min-w-0 p-3 sm:p-6 space-y-4">
      <Nav />
      <div>
        <a className="underline text-sm" href="/imports">
          Back to Imports
        </a>
        <h1 className="text-3xl font-bold">{photoInput === "camera" ? "Camera import" : photoInput === "photos" ? "Upload card photos" : "Scan cards"}</h1>
      </div>
      <ImportTaskNav selected={photoInput ?? "scan"} />
      {!photoInput && <p role="note" className="rounded border border-amber-500 p-3 text-sm">fi-7160 count control requires helper 0.4.2 and the Cards profile with Pre-Pick Off. Use expendable cards until your setup passes a supervised test.</p>}
      {!photoInput && <ScannerConnections newBatchHref="/imports/scan?input=scanner#new-scan-batch" />}
      <AcquisitionCapture
        key={initialBatch || initialSetup?.continueFrom || photoInput || "new"}
        userId={user.id}
        locations={storage}
        initialSetup={initialSetup}
        setupMessage={setupMessage}
        initialBatch={initialBatch}
        initialScanner={params.input === "scanner" || !!initialSetup}
        photoInput={photoInput}
        recent={recent}
      />
    </main>
  );
}
