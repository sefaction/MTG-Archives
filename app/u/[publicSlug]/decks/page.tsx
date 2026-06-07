import { notFound } from "next/navigation";
import { PublicCollectionNav } from "@/components/PublicCollectionNav";
import { getPublicProfileBySlug } from "@/lib/public-collection";

export const dynamic = "force-dynamic";

export default async function PublicDecksPage({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  const viewer = await getPublicProfileBySlug(publicSlug);
  if (!viewer?.playerId) notFound();
  const displayName = viewer.publicDisplayName || viewer.displayName;
  return (
    <main className="p-8 space-y-4">
      <PublicCollectionNav publicSlug={publicSlug} displayName={displayName} />
      <h1 className="text-3xl font-bold">{displayName}&apos;s public decks</h1>
      <p className="rounded border border-zinc-800 p-4 text-zinc-400">
        Public deck pages are planned. Deck visibility defaults are already
        stored in account settings for future deck features.
      </p>
    </main>
  );
}
