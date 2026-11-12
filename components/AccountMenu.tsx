"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function AccountMenu({ name, color, adminModeActive, children }: {
  name: string;
  color: string;
  adminModeActive: boolean;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.current?.open) return;
      event.preventDefault();
      menu.current.open = false;
      if (menu.current.contains(document.activeElement)) menu.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details className="archive-account" ref={menu} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}>
      <summary aria-label={`${name} account options`}>
        <span aria-hidden="true" className="archive-account-dot" style={{ backgroundColor: color }} />
        <span className="archive-account-name" title={name}>{name}</span>
        {adminModeActive && <span className="archive-account-admin">Admin</span>}
        <span aria-hidden="true" className="archive-account-chevron">⌄</span>
      </summary>
      <div className="archive-account-panel">{children}</div>
    </details>
  );
}
