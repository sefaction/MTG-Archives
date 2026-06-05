import Link from "next/link";
import { logout, getCurrentUser, isAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

const mainLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/imports", label: "Import" },
  { href: "/trades", label: "Trades" },
];

export async function Nav() {
  const user = await getCurrentUser();
  const isAdmin = isAdminUser(user, user?.player);
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";

  async function doLogout() {
    "use server";
    await logout();
    redirect("/dashboard");
  }

  return (
    <nav className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard" className="font-bold text-sky-200">
          {appName}
        </Link>
        {mainLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
        {isAdmin ? <Link href="/admin">Admin</Link> : null}
      </div>
      <div className="flex items-center gap-3 text-sm text-zinc-300">
        {user ? (
          <>
            <span>{user.displayName || user.username}</span>
            <Link
              className="rounded border border-zinc-700 px-3 py-1"
              href="/change-password"
            >
              Account
            </Link>
            <form action={doLogout}>
              <button className="rounded border border-zinc-700 px-3 py-1">
                Log out
              </button>
            </form>
          </>
        ) : (
          <Link
            className="rounded border border-sky-700 px-3 py-1"
            href="/login"
          >
            Log in
          </Link>
        )}
      </div>
    </nav>
  );
}
