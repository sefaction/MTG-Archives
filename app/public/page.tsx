import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";

export default function PublicHomePage() {
  return (
    <main className="p-8 space-y-6">
      <PublicNav />
      <section className="rounded border border-zinc-800 p-6 space-y-4">
        <h1 className="text-3xl font-bold">Public collections</h1>
        <p className="text-zinc-300">
          Browse cards and collections that MTG Inventory users have chosen to
          make public. Public pages are read-only and only include
          public-visible quantities.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/public/inventory" className="border px-3 py-2">
            Browse Public Inventory
          </Link>
          <Link href="/public/decks" className="border px-3 py-2">
            Browse Public Decks
          </Link>
        </div>
      </section>
    </main>
  );
}
