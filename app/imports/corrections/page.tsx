import { Nav } from "@/components/Nav";
import { CorrectionLibrary } from "@/components/CorrectionLibrary";
import { requireLogin, getAccessScope } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function CorrectionPage() {
  const user = await requireLogin(), scope = await getAccessScope(user);
  const accounts = scope?.mode === "admin"
    ? await prisma.correctionLibraryAccount.findMany({ select: { ownerPlayerId: true }, orderBy: { ownerPlayerId: "asc" } }) : [];
  const ids = [...new Set([user.playerId, ...accounts.map(a => a.ownerPlayerId)].filter((id): id is string => !!id))];
  const players = await prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return <main className="min-w-0 p-3 sm:p-6 space-y-4"><Nav />
    <a href="/imports/scan" className="underline text-sm">Back to Scan cards</a>
    <h1 className="text-3xl font-bold">Correction photos</h1>
    <p className="text-sm">Photos and saved suggestions are kept privately when a review changes the suggested printing. A 2% random sample of new scans also helps show how often normal scans need corrections. Collected labels still need independent verification.</p>
    <CorrectionLibrary owners={ids.map(id => ({ id, name: players.find(p => p.id === id)?.displayName ?? "Archived owner" }))} initialOwner={user.playerId ?? ids[0] ?? ""} />
  </main>;
}
