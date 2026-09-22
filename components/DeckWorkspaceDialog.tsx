"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modal keeps keyboard focus and scrolling inside the active task. */
export function DeckWorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, summary, [tabindex]",
          ),
        ).filter(
          (node) =>
            node.tabIndex >= 0 &&
            !node.matches(":disabled") &&
            node.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      className="deck-task-dialog m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-[var(--app-text)] backdrop:bg-black/60"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="deck-workspace-button shrink-0"
        >
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
