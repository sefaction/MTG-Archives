"use client";

import { ReactNode, useMemo, useState } from "react";
import { cn } from "@/components/filterStyles";

import { DeckWorkspaceDialog } from "./DeckWorkspaceDialog";

type DeckActionPanelId =
  "add-card" | "paste-decklist" | "return-committed" | "settings" | "delete";

type DeckActionItem = {
  id: DeckActionPanelId;
  label: string;
  shortLabel: string;
  href?: string;
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
  pasteDecklistHref,
  returnCommitted,
  settings,
  deleteDeck,
  inventoryCommitmentEnabled = true,
}: {
  deckName: string;
  committedQuantity: number;
  canReturnCommitted: boolean;
  addCard: ReactNode;
  pasteDecklist: ReactNode;
  pasteDecklistHref?: string;
  returnCommitted: ReactNode;
  settings: ReactNode;
  deleteDeck: ReactNode;
  inventoryCommitmentEnabled?: boolean;
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
      {
        id: "paste-decklist",
        label: "Paste decklist",
        shortLabel: "Import",
        href: pasteDecklistHref,
      },
      ...(inventoryCommitmentEnabled
        ? [
            {
              id: "return-committed" as const,
              label: `Return committed (${committedQuantity})`,
              shortLabel: "Return",
              disabled: !canReturnCommitted,
            },
          ]
        : []),
      { id: "settings", label: "Deck settings", shortLabel: "Settings" },
      {
        id: "delete",
        label: "Delete deck",
        shortLabel: "More",
        danger: true,
      },
    ],
    [
      canReturnCommitted,
      committedQuantity,
      inventoryCommitmentEnabled,
      pasteDecklistHref,
    ],
  );

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
    <div className="flex flex-wrap gap-2" aria-label="Deck action toolbar">
      <button
        type="button"
        className="deck-workspace-button deck-workspace-primary"
        onClick={() => setActivePanel("add-card")}
      >
        Add card
      </button>
      {pasteDecklistHref ? (
        <a href={pasteDecklistHref} className="deck-workspace-button">
          Paste decklist
        </a>
      ) : (
        <button
          type="button"
          className="deck-workspace-button"
          onClick={() => setActivePanel("paste-decklist")}
        >
          Paste decklist
        </button>
      )}
      <button
        type="button"
        className="deck-workspace-button"
        onClick={() => setActivePanel("settings")}
      >
        Deck options
      </button>
      {activePanel && activeAction ? (
        <DeckWorkspaceDialog
          title={activeAction.label}
          onClose={() => setActivePanel(null)}
        >
          <p className="mb-3 break-words text-sm text-[var(--app-muted)]">
            {deckName}
          </p>
          <nav
            className="mb-4 flex flex-wrap gap-2"
            aria-label="Deck action panels"
          >
            {actions.map((action) =>
              action.href ? (
                <a
                  key={action.id}
                  href={action.href}
                  className="deck-workspace-button"
                >
                  {action.label}
                </a>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  aria-pressed={activePanel === action.id}
                  className={cn(
                    "deck-workspace-button",
                    activePanel === action.id && "deck-workspace-primary",
                    action.danger && "border-red-700",
                  )}
                  onClick={() => setActivePanel(action.id)}
                >
                  {action.label}
                </button>
              ),
            )}
          </nav>
          <div className="deck-action-panel-body min-w-0 space-y-2 text-sm">
            {activeContent}
          </div>
        </DeckWorkspaceDialog>
      ) : null}
    </div>
  );
}
