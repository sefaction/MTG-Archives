"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { cn, filterPanelClass } from "./filterStyles";

type CollapsiblePanelProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  summary?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function CollapsiblePanel({
  title,
  children,
  defaultOpen = false,
  summary,
  className,
  contentClassName,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const panelId = `collapsible-panel-${generatedId}`;

  return (
    <section className={cn(filterPanelClass, "space-y-3", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0">
          <span className="block font-semibold text-zinc-100">{title}</span>
          {summary ? (
            <span className="mt-0.5 block text-xs text-zinc-400">
              {summary}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-zinc-300">
          {open ? "Hide" : "Show"}
          <span
            className={cn(
              "inline-block transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          >
            ▾
          </span>
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn("space-y-3", contentClassName)}
      >
        {children}
      </div>
    </section>
  );
}
