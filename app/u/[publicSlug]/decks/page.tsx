import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PublicDecksPage({
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
      <Link
        className="text-sm text-sky-300 underline"
        href={`/u/${publicSlug}`}
      >
        {displayName}
      </Link>
      <h1 className="text-3xl font-bold">{displayName}&apos;s public decks</h1>
      <p className="rounded border border-zinc-800 p-4 text-zinc-400">
        Public deck pages are planned. Deck visibility defaults are already
        stored in account settings for future deck features.
      </p>
      <Link
        className="text-sky-300 underline"
        href={`/u/${publicSlug}/inventory`}
      >
        View public inventory
      </Link>
    </main>
  );
}
