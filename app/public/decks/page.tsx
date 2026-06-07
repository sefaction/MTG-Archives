import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PublicDecksPage() {
  return (
    <main className="p-8 space-y-6">
      <nav className="flex flex-wrap gap-4 border-b border-zinc-800 pb-4 text-sm">
        <Link href="/public" className="font-bold text-sky-200">
          Public collections
        </Link>
        <Link href="/public/inventory">Public inventory</Link>
        <Link href="/login">Log in</Link>
      </nav>
      <section className="rounded border border-zinc-800 p-6 space-y-3">
        <h1 className="text-3xl font-bold">Public decks</h1>
        <p className="text-zinc-400">
          Public deck browsing is planned. Deck visibility defaults are already
          stored in account settings for future deck features.
        </p>
      </section>
    </main>
  );
}
