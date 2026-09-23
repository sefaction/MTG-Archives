"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { NavigationLayout } from "@/lib/navigation-layout";

const groups = [
  { label: "Overview", links: [["/dashboard", "Dashboard"]] },
  {
    label: "Collection",
    links: [
      ["/inventory", "Inventory"],
      ["/locations", "Locations"],
      ["/imports", "Import"],
    ],
  },
  {
    label: "Build & trade",
    links: [
      ["/decks", "Decks"],
      ["/wishlist", "Wishlist"],
      ["/trades", "Trades"],
      ["/pricing", "Pricing"],
    ],
  },
  {
    label: "Explore",
    links: [
      ["/public/inventory", "Public"],
      ["/league", "Commander League"],
    ],
  },
  { label: "Preferences", links: [["/settings", "Settings"]] },
];

export function ArchiveNavigation({
  appName,
  adminModeActive,
  navigationLayout,
  children,
}: {
  appName: string;
  adminModeActive: boolean;
  navigationLayout: NavigationLayout;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const resize = () => {
      if (menu.current) menu.current.open = !query.matches;
    };
    resize();
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  return (
    <header className="archive-shell" data-navigation-layout={navigationLayout}>
      <a className="archive-skip" href="#archive-content">
        Skip navigation
      </a>
      <details
        open
        className="archive-navigation"
        ref={menu}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            menu.current?.open &&
            window.matchMedia("(max-width: 899px)").matches
          ) {
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary>Menu</summary>
        <nav aria-label="Archive navigation" className="archive-rail">
          <Link href="/dashboard" className="app-nav-brand">
            {appName}
          </Link>
          {groups.map((group) => (
            <div className="archive-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.links.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={
                    pathname === href ||
                    pathname.startsWith(`${href}/`) ||
                    (href === "/public/inventory" &&
                      pathname.startsWith("/public"))
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    if (
                      menu.current &&
                      window.matchMedia("(max-width: 899px)").matches
                    )
                      menu.current.open = false;
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          ))}
          {adminModeActive && (
            <Link
              href="/admin"
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            >
              Admin
            </Link>
          )}
        </nav>
      </details>
      <div className="archive-utilities">{children}</div>
      <span id="archive-content" tabIndex={-1} />
    </header>
  );
}
