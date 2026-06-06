import Link from "next/link";
import {
  logout,
  getCurrentUser,
  isAdminModeEnabled,
  isAdminUser,
  setAdminMode,
} from "@/lib/auth";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/feedback/SubmitButton";

const mainLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/locations", label: "Locations" },
  { href: "/imports", label: "Import" },
  { href: "/trades", label: "Trades" },
];

export async function Nav() {
  const user = await getCurrentUser();
  const userIsAdmin = isAdminUser(user, user?.player);
  const adminModeActive = await isAdminModeEnabled(user);
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";

  async function doLogout() {
    "use server";
    await logout();
    redirect("/dashboard");
  }

  async function enterAdminMode() {
    "use server";
    await setAdminMode(true);
    redirect("/dashboard");
  }

  async function exitAdminMode() {
    "use server";
    await setAdminMode(false);
    redirect("/dashboard");
  }

  return (
    <>
      {adminModeActive ? (
        <div className="mb-4 rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
          Admin mode is active. You can view and manage inventory across users.
        </div>
      ) : null}
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
          {adminModeActive ? <Link href="/admin">Admin</Link> : null}
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          {user ? (
            <>
              <span>{user.displayName || user.username}</span>
              {userIsAdmin ? (
                <form action={adminModeActive ? exitAdminMode : enterAdminMode}>
                  <SubmitButton
                    pendingLabel={adminModeActive ? "Exiting…" : "Entering…"}
                    className={`rounded border px-3 py-1 ${
                      adminModeActive
                        ? "border-amber-500 text-amber-100"
                        : "border-sky-700 text-sky-100"
                    }`}
                    minWidthClassName="min-w-32"
                  >
                    {adminModeActive ? "Exit Admin Mode" : "Enter Admin Mode"}
                  </SubmitButton>
                </form>
              ) : null}
              <Link
                className="rounded border border-zinc-700 px-3 py-1"
                href="/change-password"
              >
                Account
              </Link>
              <form action={doLogout}>
                <SubmitButton
                  pendingLabel="Logging out…"
                  className="rounded border border-zinc-700 px-3 py-1"
                  minWidthClassName="min-w-20"
                >
                  Log out
                </SubmitButton>
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
    </>
  );
}
