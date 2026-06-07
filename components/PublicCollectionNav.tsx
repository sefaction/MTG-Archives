import Link from "next/link";

export function PublicCollectionNav({
  publicSlug,
  displayName,
}: {
  publicSlug: string;
  displayName: string;
}) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  return (
    <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/" className="font-bold text-sky-200">
          {appName}
        </Link>
        <Link href={`/u/${publicSlug}`}>{displayName}</Link>
        <Link href="/public/inventory">All public inventory</Link>
        <Link href={`/public/inventory?owner=${publicSlug}`}>
          This collection
        </Link>
        <Link href="/public/decks">Public decks</Link>
      </div>
      <Link className="rounded border border-sky-700 px-3 py-1" href="/login">
        Log in
      </Link>
    </nav>
  );
}
