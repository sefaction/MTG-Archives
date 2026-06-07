import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicCollectionNav } from "@/components/PublicCollectionNav";
import { deckCardCount, deckFormatLabel, publicDeckWhere } from "@/lib/decks";
import { getPublicProfileBySlug } from "@/lib/public-collection";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PublicUserDecksPage({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  const viewer = await getPublicProfileBySlug(publicSlug);
  if (!viewer) notFound();
  const displayName = viewer.publicDisplayName || viewer.displayName;
  const decks = await prisma.deck.findMany({
    where: { AND: [publicDeckWhere(), { ownerUserId: viewer.id }] },
    include: { cards: { select: { quantity: true, section: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <main className="p-8 space-y-4">
      <PublicCollectionNav publicSlug={publicSlug} displayName={displayName} />
      <h1 className="text-3xl font-bold">{displayName}&apos;s public decks</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {decks.map((deck) => (
          <Link
            key={deck.id}
            href={`/decks/${deck.id}`}
            className="rounded border border-zinc-800 p-4 hover:border-sky-800"
          >
            <h2 className="text-xl font-semibold text-sky-100">{deck.name}</h2>
            <p className="text-sm">
              {deckFormatLabel(deck.format)} · {deckCardCount(deck.cards)} cards
            </p>
          </Link>
        ))}
        {decks.length === 0 ? (
          <p className="rounded border border-zinc-800 p-4 text-zinc-400">
            No public decks yet.
          </p>
        ) : null}
      </div>
    </main>
  );
}
