import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  const viewer = await prisma.user.findUnique({
    where: { publicSlug },
    select: {
      displayName: true,
      publicDisplayName: true,
      publicProfileEnabled: true,
      playerId: true,
    },
  });
  if (!viewer?.publicProfileEnabled || !viewer.playerId) notFound();
  const displayName = viewer.publicDisplayName || viewer.displayName;
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">{displayName}</h1>
      <p className="text-zinc-400">Public MTG collection profile.</p>
      <Link
        className="text-sky-300 underline"
        href={`/u/${publicSlug}/inventory`}
      >
        View public inventory
      </Link>
      <Link
        className="block text-sky-300 underline"
        href={`/u/${publicSlug}/decks`}
      >
        View public decks
      </Link>
    </main>
  );
}
