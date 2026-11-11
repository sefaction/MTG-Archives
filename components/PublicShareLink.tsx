"use client";

import { useState } from "react";
import { filterButtonClass } from "@/components/filterStyles";

export function PublicShareLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const [status, setStatus] = useState("");

  async function copyLink() {
    try {
      const url = new URL(href, window.location.origin);
      await navigator.clipboard.writeText(url.href);
      setStatus("Link copied.");
    } catch {
      setStatus("Copy the link address from the link menu.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <a href={href} className="underline">
        {label}
      </a>
      <button type="button" className={filterButtonClass} onClick={copyLink}>
        Copy link
      </button>
      <span className="app-muted" role="status">
        {status}
      </span>
    </div>
  );
}
