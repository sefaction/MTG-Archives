import { notFound } from "next/navigation";
import { PublicCollectionNav } from "@/components/PublicCollectionNav";
import { getPublicProfileBySlug } from "@/lib/public-collection";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
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
      <h1 className="text-3xl font-bold">{displayName}</h1>
      <p className="text-zinc-400">Public MTG collection profile.</p>
    </main>
  );
}
