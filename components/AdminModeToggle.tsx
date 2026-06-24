"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SubmitButton } from "@/components/feedback/SubmitButton";

const ADMIN_MODE_SCROLL_STORAGE_KEY = "mtg-admin-mode-scroll";

type AdminModeToggleProps = {
  active: boolean;
  enterAction: (formData: FormData) => void | Promise<void>;
  exitAction: (formData: FormData) => void | Promise<void>;
};

export function AdminModeToggle({
  active,
  enterAction,
  exitAction,
}: AdminModeToggleProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const returnTo = `${pathname}${search ? `?${search}` : ""}`;
  const action = active ? exitAction : enterAction;

  useEffect(() => {
    const raw = window.sessionStorage.getItem(ADMIN_MODE_SCROLL_STORAGE_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(ADMIN_MODE_SCROLL_STORAGE_KEY);

    try {
      const parsed = JSON.parse(raw) as {
        returnTo?: string;
        scrollY?: number;
        createdAt?: number;
      };
      const isFresh =
        typeof parsed.createdAt === "number" &&
        Date.now() - parsed.createdAt < 30_000;
      const scrollY = parsed.scrollY;
      if (
        parsed.returnTo === returnTo &&
        typeof scrollY === "number" &&
        scrollY > 0 &&
        isFresh
      ) {
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
      }
    } catch {
      // Ignore stale or malformed scroll state.
    }
  }, [returnTo]);

  return (
    <form
      action={action}
      onSubmit={() => {
        window.sessionStorage.setItem(
          ADMIN_MODE_SCROLL_STORAGE_KEY,
          JSON.stringify({
            returnTo,
            scrollY: window.scrollY,
            createdAt: Date.now(),
          }),
        );
      }}
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton
        pendingLabel={active ? "Exiting..." : "Entering..."}
        className={`rounded border px-3 py-1 ${
          active
            ? "border-amber-600 bg-amber-950/30 text-amber-100 hover:border-amber-400 hover:bg-amber-900/30"
            : "border-cyan-700 bg-cyan-950/30 text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900/40"
        }`}
        minWidthClassName="min-w-32"
      >
        {active ? "Exit Admin Mode" : "Enter Admin Mode"}
      </SubmitButton>
    </form>
  );
}
