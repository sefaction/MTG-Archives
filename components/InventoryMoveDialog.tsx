"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { filterButtonClass } from "./filterStyles";

export function InventoryMoveDialog({
  open,
  busy,
  onClose,
  children,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-4xl overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-0 text-[var(--app-text)] shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="flex max-h-[94dvh] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-5 py-4">
            <div>
              <h2 id={titleId} className="text-xl font-semibold">
                Move inventory
              </h2>
              <p className="text-sm text-[var(--app-muted)]">
                Choose a home for the copies in your selected inventory entries.
              </p>
            </div>
            <button
              type="button"
              className={filterButtonClass}
              disabled={busy}
              onClick={onClose}
              aria-label="Close move panel"
            >
              ✕
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
