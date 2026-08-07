import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export async function PublicNav() {
  const user = await getCurrentUser();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  return (
    <>
      {user ? (
        <Nav />
      ) : (
        <nav className="app-nav mb-3 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="app-nav-brand">
            {appName}
          </Link>
          <Link
            className="rounded-md border border-cyan-700 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900/40"
            href="/login"
          >
            Log in
          </Link>
        </nav>
      )}
      <nav
        className="mb-6 flex flex-wrap items-center gap-4 border-b border-zinc-800 pb-3 text-sm"
        aria-label="Public browsing"
      >
        <Link href="/public" className="app-nav-link">
          Public home
        </Link>
        <Link href="/public/inventory" className="app-nav-link">
          Public inventory
        </Link>
        <Link href="/public/decks" className="app-nav-link">
          Public decks
        </Link>
      </nav>
    </>
  );
}
