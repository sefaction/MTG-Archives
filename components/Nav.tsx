import Link from "next/link";
import type { ReactNode } from "react";
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
import { safeLocalReturnPath } from "@/lib/local-return-path";
import { ArchiveNavigation } from "@/components/ArchiveNavigation";
import { normalizeNavigationLayout } from "@/lib/navigation-layout";
import { AccountMenu } from "@/components/AccountMenu";

function getSafeReturnTo(formData: FormData) {
  return safeLocalReturnPath(formData.get("returnTo"));
}

function AnonymousNavigation({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <nav className="app-nav mb-6 flex flex-wrap items-center justify-between gap-4">
      {children}
    </nav>
  );
}

export async function Nav({ deckHunt = false, sectionNavigation }: { deckHunt?: boolean; sectionNavigation?: ReactNode } = {}) {
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

  const Navigation = user ? ArchiveNavigation : AnonymousNavigation;
  return (
    <>
      {adminModeActive ? (
        <div className="mb-4 rounded-lg border border-amber-700/70 bg-amber-950/30 px-4 py-3 text-sm font-medium text-amber-100 shadow-sm shadow-black/20">
          Admin mode is active. You can view and manage inventory across users.
        </div>
      ) : null}
      <Navigation
        appName={appName}
        deckHunt={deckHunt}
        navigationLayout={normalizeNavigationLayout(user?.navigationLayout)}
        sectionNavigation={sectionNavigation}
      >
        {!user && (
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="app-nav-brand">
              {appName}
            </Link>
            <Link href="/public/inventory" className="app-nav-link">Public</Link>
          </div>
        )}
        <div className="archive-utility-actions flex min-w-0 items-center gap-2 text-sm text-stone-300">
          {user ? (
            <>
              <NotificationBell
                key={`notifications-${unreadNotificationCount}`}
                appName={appName}
                initialUnreadCount={unreadNotificationCount}
                compact
              />
              <AccountMenu name={user.displayName || user.username}
                color={normalizePlayerColor(user.player?.color)} adminModeActive={adminModeActive}>
                {userIsAdmin ? (
                  <AdminModeToggle
                    active={adminModeActive}
                    enterAction={enterAdminMode}
                    exitAction={exitAdminMode}
                  />
                ) : null}
                <Link
                  className="rounded-md border border-[#364139] px-3 py-1 text-stone-200 hover:border-cyan-700 hover:bg-cyan-950/20 hover:text-cyan-100"
                  href="/settings"
                >
                  Settings
                </Link>
                {adminModeActive && (
                  <Link href="/admin" className="rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 font-medium text-amber-100 hover:border-amber-500 hover:text-amber-50">
                    Admin
                  </Link>
                )}
                <form action={doLogout}>
                  <SubmitButton
                    pendingLabel="Logging out..."
                    className="rounded-md border border-[#364139] px-3 py-1 text-stone-200 hover:border-[#4a584d] hover:bg-[#17201b]"
                    minWidthClassName="min-w-20"
                  >
                    Log out
                  </SubmitButton>
                </form>
              </AccountMenu>
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
      </Navigation>
    </>
  );
}
