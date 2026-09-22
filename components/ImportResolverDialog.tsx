"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ImportResolverDialog({
  children,
  closeHref,
}: {
  children: ReactNode;
  closeHref: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog?.open) dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="import-resolver-title"
      onCancel={(event) => {
        event.preventDefault();
        window.location.assign(closeHref);
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-3xl overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-[var(--app-text)] backdrop:bg-black/60"
    >
      <div className="min-w-0 space-y-4">{children}</div>
    </dialog>
  );
}
