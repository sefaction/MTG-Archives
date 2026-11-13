"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { deckToolContextHref } from "@/lib/deck-card-browse";

export function DeckToolLink({
  href,
  children,
  className,
  "aria-current": current,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-current"?: "page";
}) {
  const params = useSearchParams();
  return (
    <Link
      href={deckToolContextHref(href, params)}
      className={className}
      aria-current={current}
    >
      {children}
    </Link>
  );
}
