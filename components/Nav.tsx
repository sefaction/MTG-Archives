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
import { AdminModeToggle } from "@/components/AdminModeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { normalizePlayerColor } from "@/lib/player-colors";

const mainLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/public/inventory", label: "Public" },
  { href: "/pricing", label: "Pricing" },
  { href: "/decks", label: "Decks" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/locations", label: "Locations" },
  { href: "/imports", label: "Import" },
  { href: "/trades", label: "Trades" },
  { href: "/settings", label: "Settings" },
];

function getSafeReturnTo(formData: FormData) {
  const returnTo = formData.get("returnTo");
  if (
    typeof returnTo !== "string" ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//")
  ) {
    return "/dashboard";
  }
  return returnTo;
}

export async function Nav() {
  const user = await getCurrentUser();
  const userIsAdmin = isAdminUser(user, user?.player);
  const adminModeActive = await isAdminModeEnabled(user);
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  const unreadNotificationCount = user
    ? await getUnreadNotificationCount(user.id)
    : 0;

  async function doLogout() {
    "use server";
    await logout();
    redirect("/dashboard");
  }

  async function enterAdminMode(formData: FormData) {
    "use server";
    await setAdminMode(true);
    redirect(getSafeReturnTo(formData));
  }

  async function exitAdminMode(formData: FormData) {
    "use server";
    await setAdminMode(false);
    redirect(getSafeReturnTo(formData));
  }

  return (
    <>
      {adminModeActive ? (
        <div className="mb-4 rounded-lg border border-amber-700/70 bg-amber-950/30 px-4 py-3 text-sm font-medium text-amber-100 shadow-sm shadow-black/20">
          Admin mode is active. You can view and manage inventory across users.
        </div>
      ) : null}
      <nav className="app-nav mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="app-nav-brand">
            {appName}
          </Link>
          {mainLinks.map((link) => (
            <Link key={link.href} href={link.href} className="app-nav-link">
              {link.label}
            </Link>
          ))}
          {adminModeActive ? (
            <Link
              href="/admin"
              className="rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-sm font-medium text-amber-100 hover:border-amber-500 hover:text-amber-50"
            >
              Admin
            </Link>
          ) : null}
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 text-sm text-stone-300 lg:w-auto">
          {user ? (
            <>
              <span className="inline-flex items-center gap-2 text-stone-300">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: normalizePlayerColor(user.player?.color),
                  }}
                />
                {user.displayName || user.username}
              </span>
              {userIsAdmin ? (
                <AdminModeToggle
                  active={adminModeActive}
                  enterAction={enterAdminMode}
                  exitAction={exitAdminMode}
                />
              ) : null}
              <NotificationBell
                key={`notifications-${unreadNotificationCount}`}
                appName={appName}
                initialUnreadCount={unreadNotificationCount}
              />
              <Link
                className="rounded-md border border-[#364139] px-3 py-1 text-stone-200 hover:border-cyan-700 hover:bg-cyan-950/20 hover:text-cyan-100"
                href="/change-password"
              >
                Account
              </Link>
              <form action={doLogout}>
                <SubmitButton
                  pendingLabel="Logging out..."
                  className="rounded-md border border-[#364139] px-3 py-1 text-stone-200 hover:border-[#4a584d] hover:bg-[#17201b]"
                  minWidthClassName="min-w-20"
                >
                  Log out
                </SubmitButton>
              </form>
            </>
          ) : (
            <Link
              className="rounded-md border border-cyan-700 bg-cyan-950/30 px-3 py-1 text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900/40"
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
