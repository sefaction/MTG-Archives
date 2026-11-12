import Link from "next/link";
import { getRenderUser } from "@/lib/render-context";
import { Nav } from "@/components/Nav";

export async function PublicNav({
  active,
}: { active?: "home" | "inventory" | "decks" } = {}) {
  const user = await getRenderUser();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  const publicSections = (
      <nav
        className="flex flex-wrap items-center gap-3 text-sm"
        aria-label="Public browsing"
      >
        <span className="w-full font-semibold text-[var(--app-muted)]">
          Public browsing · read-only collections
        </span>
        <Link
          href="/public"
          className="app-nav-link"
          aria-current={active === "home" ? "page" : undefined}
        >
          Public home
        </Link>
        <Link
          href="/public/inventory"
          className="app-nav-link"
          aria-current={active === "inventory" ? "page" : undefined}
        >
          Public inventory
        </Link>
        <Link
          href="/public/decks"
          className="app-nav-link"
          aria-current={active === "decks" ? "page" : undefined}
        >
          Public decks
        </Link>
        {user ? (
          <Link href="/dashboard" className="app-nav-link sm:ml-auto">
            Back to my dashboard
          </Link>
        ) : null}
      </nav>
  );
  return user ? (
    <Nav sectionNavigation={publicSections} />
  ) : (
    <>
      <nav className="app-nav mb-3 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="app-nav-brand">{appName}</Link>
        <Link className="rounded-md border border-cyan-700 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900/40" href="/login">Log in</Link>
      </nav>
      <div className="mb-4 border-b border-[var(--app-border)] pb-3">{publicSections}</div>
    </>
  );
}
