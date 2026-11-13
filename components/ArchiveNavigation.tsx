"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

const sectionLinks: Record<string, readonly (readonly [string, string])[]> = {
  "/inventory": inventoryLinks,
  "/wishlist": [
    ["/wishlist", "Combined"],
    ["/wishlist?reason=decks", "Deck needs"],
    ["/wishlist?reason=members", "From members"],
    ["/wishlist?reason=sets", "Set Completion"],
    ["/wishlist?reason=manual", "Manual wishes"],
  ],
  "/trades": [
    ["/trades", "Trade Desk"],
    ["/trades?view=wishlist", "Trade Wishlist"],
    ["/trades?view=active", "Active Trades"],
    ["/trades?view=history", "History"],
  ],
  "/public/inventory": [
    ["/public", "Public home"],
    ["/public/inventory", "Public inventory"],
    ["/public/decks", "Public decks"],
  ],
};

function NavigationDestination({ href, label, current, onNavigate, expanded, setExpanded, horizontal, previewed, onPreview, onOpenRow }: {
  href: string;
  label: string;
  current?: "page" | "location";
  onNavigate: () => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  horizontal: boolean;
  previewed: boolean;
  onPreview: (trigger: HTMLAnchorElement) => void;
  onOpenRow: (trigger: HTMLAnchorElement) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const links = sectionLinks[href];
  const panelId = `archive-submenu-${href.split("/")[1]}`;
  const cancelClose = () => {
    if (timeout.current) clearTimeout(timeout.current);
  };
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (timeout.current) clearTimeout(timeout.current);
      setExpanded(false);
      if (group.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [expanded, setExpanded]);
  if (horizontal) {
    return (
      <div className="archive-destination">
        <Link href={href} aria-current={current} data-section-preview={previewed || undefined}
          onPointerEnter={(event) => { if (event.pointerType === "mouse") onPreview(event.currentTarget); }}
          onFocus={(event) => onPreview(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && links) {
              event.preventDefault();
              onOpenRow(event.currentTarget);
            }
          }} onClick={onNavigate}>{label}</Link>
      </div>
    );
  }
  return (
    <div ref={group} className="archive-destination"
      onPointerEnter={(event) => {
        cancelClose();
        if (event.pointerType === "mouse" && links) setExpanded(true);
      }}
      onPointerLeave={() => {
        cancelClose();
        timeout.current = setTimeout(() => {
          if (!group.current?.contains(document.activeElement)) setExpanded(false);
        }, 200);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}>
      <div className="archive-destination-heading">
        <Link href={href} aria-current={current} onClick={() => {
          setExpanded(false);
          onNavigate();
        }}>{label}</Link>
        {links && <button ref={button} type="button" className="archive-submenu-toggle"
          aria-label={`${label} sections`} aria-expanded={expanded} aria-controls={panelId}
          onClick={() => { cancelClose(); setExpanded(!expanded); }}>
          <span aria-hidden="true">⌄</span>
        </button>}
      </div>
      {links && <div id={panelId} className="archive-submenu" hidden={!expanded}>
        {links.map(([target, text]) => <Link key={target} href={target} onClick={() => {
          setExpanded(false);
          onNavigate();
        }}>{text}</Link>)}
      </div>}
    </div>
  );
}

function inSection(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ArchiveNavigation({
  appName,
  deckHunt = false,
  navigationLayout,
  sectionNavigation,
  children,
}: {
  appName: string;
  deckHunt?: boolean;
  navigationLayout: NavigationLayout;
  sectionNavigation?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [expandedDestination, setExpandedDestination] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [preview, setPreview] = useState<{ href: string; pathname: string } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const restoringFocus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const horizontal = navigationLayout === "topbar" && wide;
  const inventoryTab = deckHunt ? undefined : inventoryLinks.find(([href]) => inSection(pathname, href))?.[0];
  const section = deckHunt ? "/decks" : inventoryTab ? "/inventory"
    : destinations.find(([href]) => inSection(pathname, href === "/public/inventory" ? "/public" : href))?.[0];
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1099px)");
    const resize = () => {
      if (menu.current) menu.current.open = !query.matches;
      setWide(!query.matches);
      setExpandedDestination(null);
      setPreview(null);
    };
    resize();
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  function cancelRowClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function previewSection(href: string, link: HTMLAnchorElement) {
    cancelRowClose();
    if (restoringFocus.current) {
      restoringFocus.current = false;
      return;
    }
    trigger.current = link;
    setPreview(sectionLinks[href] ? { href, pathname } : null);
  }

  function closeCompactMenu() {
    cancelRowClose();
    setPreview(null);
    if (menu.current?.open && window.matchMedia("(max-width: 1099px)").matches) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
  }

  const previewHref = horizontal && preview?.pathname === pathname ? preview.href : null;
  const previewLinks = previewHref && previewHref !== section ? sectionLinks[previewHref] : undefined;
  const currentNavigation = sectionNavigation || (inventoryTab && (
    <nav aria-label="Inventory sections" className="archive-section-tabs flex flex-wrap gap-2">
      {inventoryLinks.map(([href, label]) => (
        <Link key={href} href={href} onClick={closeCompactMenu}
          aria-current={inventoryTab === href ? pathname === href ? "page" : "location" : undefined}
          className={cn(filterButtonClass, inventoryTab === href && "border-[var(--app-accent)] bg-[var(--app-accent-soft)] font-semibold")}>
          {label}
        </Link>
      ))}
    </nav>
  ));

  return (
    <>
      <header className="archive-shell" data-navigation-layout={navigationLayout}
        onPointerEnter={cancelRowClose}
        onPointerLeave={() => {
          if (!horizontal) return;
          cancelRowClose();
          closeTimer.current = setTimeout(() => {
            if (!row.current?.contains(document.activeElement)) setPreview(null);
          }, 200);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null);
        }}
        onKeyDown={(event) => {
          if (!horizontal || !previewHref || event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          cancelRowClose();
          if (row.current?.contains(document.activeElement)) {
            restoringFocus.current = true;
            trigger.current?.focus();
          }
          setPreview(null);
        }}>
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
              <NavigationDestination
                key={href}
                href={href}
                label={label}
                current={section === href ? pathname === href ? "page" : "location" : undefined}
                onNavigate={closeCompactMenu}
                expanded={expandedDestination === href}
                setExpanded={(expanded) => setExpandedDestination((current) => expanded ? href : current === href ? null : current)}
                horizontal={horizontal}
                previewed={previewHref === href && href !== section}
                onPreview={(link) => previewSection(href, link)}
                onOpenRow={(link) => {
                  previewSection(href, link);
                  requestAnimationFrame(() => row.current?.querySelector<HTMLAnchorElement>(
                    ".archive-section-preview a, .archive-section-current:not([hidden]) a"
                  )?.focus());
                }}
              />
            ))}
          </nav>
        </details>
        <div className="archive-utilities">{children}</div>
        <div ref={row} className="archive-section-row" data-empty={!currentNavigation && !previewLinks || undefined}
          hidden={!horizontal && !currentNavigation}>
          <div className="archive-section-current" hidden={Boolean(previewLinks)} onClick={() => setPreview(null)}>
            {currentNavigation}
          </div>
          {previewLinks && <nav className="archive-section-preview" aria-label={`${destinations.find(([href]) => href === previewHref)?.[1]} sections`}>
            {previewLinks.map(([href, label]) => <Link key={href} href={href} onClick={closeCompactMenu}>{label}</Link>)}
          </nav>}
        </div>
      </header>
      <span id="archive-content" tabIndex={-1} />
    </>
  );
}
