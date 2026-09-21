"use client";

import { useEffect, useRef } from "react";

import {
  VAULT_SECTIONS,
  VAULT_SECTION_CAPACITY,
  spaceLabel,
  type StorageLocation,
} from "@/lib/storage-sections";
import { vaultSectionHref } from "@/lib/vault-navigation";

export function VaultSectionMap({
  location,
  query = "",
  activeSection,
  unsectionedQuantity,
  selectedQuantity = 0,
  onMoveSelection,
}: {
  location: StorageLocation;
  query?: string;
  activeSection?: string | null;
  unsectionedQuantity?: number;
  selectedQuantity?: number;
  onMoveSelection?: (section: string) => void;
}) {
  const sections = VAULT_SECTIONS.map(
    (name) =>
      location.sections.find((section) => section.name === name) ?? {
        name,
        quantity: 0,
        capacity: VAULT_SECTION_CAPACITY,
      },
  );
  const extra = location.sections.filter(
    (section) => section.name && !VAULT_SECTIONS.includes(section.name),
  );
  const unsectioned =
    unsectionedQuantity ??
    location.sections.find((section) => section.name === "")?.quantity ??
    0;
  const room = sections.reduce(
    (sum, section) =>
      sum + Math.max(0, VAULT_SECTION_CAPACITY - section.quantity),
    0,
  );
  const total = [...sections, ...extra].reduce(
    (sum, section) => sum + section.quantity,
    unsectioned,
  );
  const canMove = Boolean(onMoveSelection && selectedQuantity > 0);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroller.current;
    const active = container?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (!container || !active) return;
    const bounds = container.getBoundingClientRect(),
      item = active.getBoundingClientRect();
    if (item.left < bounds.left)
      container.scrollLeft += item.left - bounds.left - 8;
    else if (item.right > bounds.right)
      container.scrollLeft += item.right - bounds.right + 8;
  }, [activeSection]);

  function moveButton(name: string) {
    return canMove ? (
      <button
        type="button"
        onClick={() => onMoveSelection?.(name)}
        aria-label={`Move selected to ${name || "Unsectioned"}`}
        className="min-h-9 w-full rounded border border-cyan-700 bg-cyan-950/30 px-2 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        Move here
      </button>
    ) : null;
  }

  return (
    <section
      aria-label={`${location.name} vault layout`}
      className="min-w-0 space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/40 p-3 sm:p-4"
    >
      <div className="flex flex-col flex-wrap items-start justify-between gap-2 sm:flex-row">
        <div className="min-w-0 flex-1 sm:basis-48">
          <h3 className="font-semibold text-zinc-100">Vault layout</h3>
          <p className="break-words text-sm text-zinc-300">{location.name}</p>
          <p className="text-xs text-zinc-400">
            {total.toLocaleString()} cards · {room.toLocaleString()} spaces
            across six sections
          </p>
        </div>
        <a
          href={vaultSectionHref(location.id, null, query)}
          className="min-h-9 shrink-0 rounded px-2 py-1 text-sm text-cyan-300 underline underline-offset-4"
          aria-current={activeSection === null ? "page" : undefined}
        >
          Browse all sections
        </a>
      </div>
      <p className="text-xs text-zinc-400">
        Sections 0–5, left to right. Capacity is advisory: 85 physical cards per
        section.
      </p>
      <div
        ref={scroller}
        className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900/70 p-2"
        tabIndex={0}
        role="group"
        aria-label="Six sections in a single row; scroll horizontally on small screens"
      >
        <div
          className="grid min-w-[33.75rem] grid-cols-6 gap-2"
          data-vault-section-row
        >
          {sections.map((section) => {
            const over = section.quantity > VAULT_SECTION_CAPACITY;
            const available = Math.max(
              0,
              VAULT_SECTION_CAPACITY - section.quantity,
            );
            const active = activeSection === section.name;
            return (
              <div
                key={section.name}
                className={`flex min-w-0 flex-col gap-2 rounded-lg border p-2 ${active ? "border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-400" : over ? "border-amber-600 bg-amber-950/20" : "border-zinc-600 bg-zinc-950/70"}`}
              >
                <a
                  href={vaultSectionHref(location.id, section.name, query)}
                  aria-label={`${section.name}, ${spaceLabel(section)}. Browse cards.`}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-1 flex-col gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                >
                  <span className="text-sm font-semibold text-zinc-100">
                    {section.name}
                  </span>
                  <div
                    aria-hidden="true"
                    className="flex h-16 items-end overflow-hidden rounded border border-zinc-700 bg-zinc-900"
                  >
                    <div
                      className={`w-full ${over ? "bg-amber-500/70" : "bg-cyan-600/60"}`}
                      style={{
                        height: `${Math.min(100, (section.quantity / VAULT_SECTION_CAPACITY) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-zinc-100">
                    {section.quantity.toLocaleString()} / 85
                  </span>
                  <span
                    className={`text-xs ${over ? "text-amber-200" : "text-zinc-300"}`}
                  >
                    {over
                      ? `${section.quantity - VAULT_SECTION_CAPACITY} over capacity`
                      : available === 0
                        ? "Full"
                        : `${available} spaces left`}
                  </span>
                  {over ? (
                    <span className="text-xs text-amber-200">
                      All cards may not fit.
                    </span>
                  ) : null}
                </a>
                {moveButton(section.name)}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
        aria-label="Other placements in this vault"
      >
        {[{ name: "", quantity: unsectioned }, ...extra].map((section) => (
          <div
            key={section.name}
            className={`min-w-32 max-w-full space-y-1 break-words rounded border px-2 py-1 ${activeSection === section.name ? "border-cyan-400 bg-cyan-950/40" : "border-zinc-700"}`}
          >
            <a
              href={vaultSectionHref(location.id, section.name, query)}
              aria-current={activeSection === section.name ? "page" : undefined}
              className="block min-h-9 py-1 text-sm text-cyan-200 underline underline-offset-4"
            >
              {section.name || "Unsectioned"} ·{" "}
              {section.quantity.toLocaleString()} cards
            </a>
            {moveButton(section.name)}
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-400">
        Counts include all cards directly in this vault, regardless of search
        filters. Extra section names and unsectioned cards are kept.
      </p>
      {canMove ? (
        <p className="text-xs text-cyan-200">
          {selectedQuantity.toLocaleString()} cards selected. Choose Move here
          to review a move; browsing another section clears this selection.
        </p>
      ) : null}
    </section>
  );
}
