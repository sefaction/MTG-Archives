"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { NavigationLayout } from "@/lib/navigation-layout";
import { cn, filterButtonClass } from "./filterStyles";

const destinations = [
  ["/dashboard", "Dashboard"],
  ["/inventory", "Inventory"],
  ["/decks", "Decks"],
  ["/wishlist", "Wishlist"],
  ["/trades", "Trades"],
  ["/public/inventory", "Public"],
  ["/league", "Commander League"],
] as const;

const inventoryLinks = [
  ["/inventory", "Cards"],
  ["/locations", "Locations"],
  ["/collector", "Collector"],
  ["/imports", "Add & export"],
  ["/pricing", "Pricing"],
  ["/card-hunt", "Card Hunt"],
] as const;

function inSection(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ArchiveNavigation({
  appName,
  deckHunt = false,
  navigationLayout,
  children,
}: {
  appName: string;
  deckHunt?: boolean;
  navigationLayout: NavigationLayout;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const inventoryTab = deckHunt ? undefined : inventoryLinks.find(([href]) => inSection(pathname, href))?.[0];
  const section = deckHunt ? "/decks" : inventoryTab ? "/inventory"
    : destinations.find(([href]) => inSection(pathname, href === "/public/inventory" ? "/public" : href))?.[0];
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1099px)");
    const resize = () => {
      if (menu.current) menu.current.open = !query.matches;
    };
    resize();
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);

  function closeCompactMenu() {
    if (menu.current?.open && window.matchMedia("(max-width: 1099px)").matches) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
  }

  return (
    <>
      <header className="archive-shell" data-navigation-layout={navigationLayout}>
        <a className="archive-skip" href="#archive-content">Skip navigation</a>
        <details
          open
          className="archive-navigation"
          ref={menu}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeCompactMenu();
          }}
        >
          <summary>Menu</summary>
          <nav aria-label="Archive navigation" className="archive-rail">
            <Link href="/dashboard" className="app-nav-brand" onClick={closeCompactMenu}>
              {appName}
            </Link>
            {destinations.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={section === href ? pathname === href ? "page" : "location" : undefined}
                onClick={closeCompactMenu}
              >
                {label}
              </Link>
            ))}
          </nav>
        </details>
        <div className="archive-utilities">{children}</div>
      </header>
      <span id="archive-content" tabIndex={-1} />
      {inventoryTab && (
        <nav aria-label="Inventory sections" className="mb-4 flex flex-wrap gap-2">
          {inventoryLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={inventoryTab === href ? pathname === href ? "page" : "location" : undefined}
              className={cn(filterButtonClass, inventoryTab === href && "border-[var(--app-accent)] bg-[var(--app-accent-soft)] font-semibold")}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
