"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  cn,
  filterButtonClass,
  filterPrimaryButtonClass,
} from "@/components/filterStyles";

type DeckActionPanelId =
  "add-card" | "paste-decklist" | "return-committed" | "settings" | "delete";

type DeckActionItem = {
  id: DeckActionPanelId;
  label: string;
  shortLabel: string;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
};

export function DeckActionPanels({
  deckName,
  committedQuantity,
  canReturnCommitted,
  addCard,
  pasteDecklist,
  returnCommitted,
  settings,
  deleteDeck,
}: {
  deckName: string;
  committedQuantity: number;
  canReturnCommitted: boolean;
  addCard: ReactNode;
  pasteDecklist: ReactNode;
  returnCommitted: ReactNode;
  settings: ReactNode;
  deleteDeck: ReactNode;
}) {
  const [activePanel, setActivePanel] = useState<DeckActionPanelId | null>(
    null,
  );

  const actions = useMemo<DeckActionItem[]>(
    () => [
      {
        id: "add-card",
        label: "Add card",
        shortLabel: "Add",
        primary: true,
      },
      { id: "paste-decklist", label: "Paste decklist", shortLabel: "Import" },
      {
        id: "return-committed",
        label: `Return committed (${committedQuantity})`,
        shortLabel: "Return",
        disabled: !canReturnCommitted,
      },
      { id: "settings", label: "Deck settings", shortLabel: "Settings" },
      {
        id: "delete",
        label: "Delete deck",
        shortLabel: "More",
        danger: true,
      },
    ],
    [canReturnCommitted, committedQuantity],
  );

  useEffect(() => {
    if (!activePanel) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel]);

  const activeAction = actions.find((action) => action.id === activePanel);
  const activeContent =
    activePanel === "add-card"
      ? addCard
      : activePanel === "paste-decklist"
        ? pasteDecklist
        : activePanel === "return-committed"
          ? returnCommitted
          : activePanel === "settings"
            ? settings
            : activePanel === "delete"
              ? deleteDeck
              : null;

  return (
    <div className="relative" aria-label="Deck action toolbar">
      <details className="group relative">
        <summary
          className={cn(
            filterPrimaryButtonClass,
            "list-none cursor-pointer px-3 py-1.5 text-sm marker:hidden",
          )}
        >
          Actions
        </summary>
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-[#364139] bg-[#101614] p-2 shadow-xl shadow-black/40">
          <div className="grid gap-1">
            {actions.map((action) => (
              <ActionButton
                key={action.id}
                active={activePanel === action.id}
                onClick={() => setActivePanel(action.id)}
                disabled={action.disabled}
                primary={action.primary}
                danger={action.danger}
              >
                {action.label}
              </ActionButton>
            ))}
            <a href="#bulk-edit" className={cn(filterButtonClass, "text-left")}>
              Bulk edit
            </a>
            <a
              href="#bulk-edit"
              className="rounded-md border border-emerald-700 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100 hover:border-emerald-500"
            >
              Optimize printings
            </a>
          </div>
        </div>
      </details>

      {activePanel && activeAction ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close deck actions"
            onClick={() => setActivePanel(null)}
          />
          <aside
            className={cn(
              "absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[#2a332d] bg-[#101614] shadow-2xl",
              activePanel === "paste-decklist" && "md:max-w-2xl",
            )}
          >
            <header className="sticky top-0 z-10 border-b border-[#2a332d] bg-[#101614]/95 p-3 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Deck actions</h2>
                  <p className="line-clamp-1 text-xs text-stone-400">
                    {deckName}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-[#364139] px-2 py-1 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  onClick={() => setActivePanel(null)}
                >
                  Close
                </button>
              </div>
              <nav
                className="mt-3 flex gap-1 overflow-x-auto text-sm"
                aria-label="Deck action panels"
              >
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={action.disabled}
                    className={cn(
                      "whitespace-nowrap rounded-md border border-[#364139] px-2 py-1 text-stone-300 focus:outline-none focus:ring-2 focus:ring-cyan-500",
                      activePanel === action.id &&
                        "border-cyan-600 bg-cyan-950/40 text-cyan-100",
                      action.danger && "border-red-950 text-red-200",
                      action.disabled && "cursor-not-allowed opacity-50",
                    )}
                    onClick={() => setActivePanel(action.id)}
                  >
                    {action.shortLabel}
                  </button>
                ))}
              </nav>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3
                  className={cn(
                    "text-base font-semibold",
                    activeAction.danger && "text-red-100",
                  )}
                >
                  {activeAction.label}
                </h3>
                {activePanel === "return-committed" &&
                committedQuantity === 0 ? (
                  <span className="text-xs text-zinc-500">
                    No committed cards to return.
                  </span>
                ) : null}
              </div>
              <div className="deck-action-panel-body space-y-2 text-sm">
                {activeContent}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  active,
  onClick,
  disabled,
  primary,
  danger,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        primary ? filterPrimaryButtonClass : filterButtonClass,
        "w-full px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500",
        danger && "border-red-900 text-red-200 hover:bg-red-950/40",
        active && "border-cyan-500 bg-cyan-950/40 text-cyan-100",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
