import { Nav } from "@/components/Nav";
import { AcquisitionCapture } from "@/components/AcquisitionCapture";
import { requireLogin, getAccessScope } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorageLocations } from "@/lib/storage-summary";
export const dynamic = "force-dynamic";
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
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
      where: { ...owner, run: { providerId: "phone-photo-v1" } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, batchNumber: true, phase: true },
    }),
  ]);
  return (
    <main className="min-w-0 p-3 sm:p-6 space-y-4">
      <Nav />
      <div>
        <a className="underline text-sm" href="/imports">
          Back to Imports
        </a>
        <h1 className="text-3xl font-bold">Scan cards</h1>
      </div>
      <AcquisitionCapture
        userId={user.id}
        locations={await getStorageLocations(prisma, locations)}
        initialBatch={(await searchParams).batch ?? ""}
        recent={recent}
      />
    </main>
  );
}
