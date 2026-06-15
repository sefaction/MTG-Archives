"use client";

import { ReactNode, useState } from "react";
import {
  cn,
  filterButtonClass,
  filterPrimaryButtonClass,
} from "@/components/filterStyles";

type DeckActionPanelId =
  | "add-card"
  | "paste-decklist"
  | "return-committed"
  | "settings"
  | "delete"
  | null;

export function DeckActionPanels({
  committedQuantity,
  canReturnCommitted,
  addCard,
  pasteDecklist,
  returnCommitted,
  settings,
  deleteDeck,
}: {
  committedQuantity: number;
  canReturnCommitted: boolean;
  addCard: ReactNode;
  pasteDecklist: ReactNode;
  returnCommitted: ReactNode;
  settings: ReactNode;
  deleteDeck: ReactNode;
}) {
  const [activePanel, setActivePanel] = useState<DeckActionPanelId>(null);

  function toggle(panel: Exclude<DeckActionPanelId, null>) {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  const panelTitle =
    activePanel === "add-card"
      ? "Add card"
      : activePanel === "paste-decklist"
        ? "Paste decklist"
        : activePanel === "return-committed"
          ? "Return committed cards"
          : activePanel === "settings"
            ? "Deck settings"
            : activePanel === "delete"
              ? "Delete deck"
              : "";

  return (
    <section
      className="rounded border border-zinc-800 bg-zinc-950/80 p-3"
      aria-label="Deck action toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          active={activePanel === "add-card"}
          onClick={() => toggle("add-card")}
          primary
        >
          Add card
        </ActionButton>
        <ActionButton
          active={activePanel === "paste-decklist"}
          onClick={() => toggle("paste-decklist")}
        >
          Paste decklist
        </ActionButton>
        <ActionButton
          active={activePanel === "return-committed"}
          onClick={() => toggle("return-committed")}
          disabled={!canReturnCommitted}
        >
          Return committed ({committedQuantity})
        </ActionButton>
        <a href="#bulk-edit" className={filterButtonClass}>
          Bulk edit
        </a>
        <a
          href="#bulk-edit"
          className="rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-100"
        >
          Optimize printings
        </a>
        <ActionButton
          active={activePanel === "settings"}
          onClick={() => toggle("settings")}
        >
          Deck settings
        </ActionButton>
        <ActionButton
          active={activePanel === "delete"}
          onClick={() => toggle("delete")}
          danger
        >
          More: Delete deck
        </ActionButton>
      </div>

      {activePanel ? (
        <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 p-3 shadow-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
            <h2 className="text-lg font-semibold">{panelTitle}</h2>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1 text-sm text-zinc-200"
              onClick={() => setActivePanel(null)}
            >
              Close panel
            </button>
          </div>
          {activePanel === "add-card" ? addCard : null}
          {activePanel === "paste-decklist" ? pasteDecklist : null}
          {activePanel === "return-committed" ? returnCommitted : null}
          {activePanel === "settings" ? settings : null}
          {activePanel === "delete" ? deleteDeck : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          Open an action only when needed; the deck list stays visible below.
        </p>
      )}
    </section>
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
        danger && "border-red-900 text-red-200 hover:bg-red-950/40",
        active && "border-sky-500 bg-sky-950/40 text-sky-100",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
