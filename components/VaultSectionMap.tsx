"use client";

import { useEffect, useRef } from "react";

import {
  VAULT_SECTIONS,
  VAULT_SECTION_CAPACITY,
  isVault,
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
  const names = location.defaultSectionNames ?? VAULT_SECTIONS;
  const standardVault =
    isVault(location.type) &&
    names.join("|") === VAULT_SECTIONS.join("|") &&
    location.sections
      .filter((section) => names.includes(section.name))
      .every((section) => section.capacity === 85);
  const sections = names.map(
    (name) =>
      location.sections.find((section) => section.name === name) ?? {
        name,
        quantity: 0,
        capacity: VAULT_SECTION_CAPACITY,
      },
  );
  const extra = location.sections.filter(
    (section) => section.name && !names.includes(section.name),
  );
  const unsectioned =
    unsectionedQuantity ??
    location.sections.find((section) => section.name === "")?.quantity ??
    0;
  const room = sections.reduce(
    (sum, section) =>
      sum +
      (section.capacity === null
        ? 0
        : Math.max(0, section.capacity - section.quantity)),
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
        className="min-h-9 w-full rounded border border-[var(--app-accent)] bg-[var(--app-accent-soft)] px-2 py-1 text-xs font-medium text-[var(--app-text)] hover:bg-[var(--app-surface-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
      >
        Move here
      </button>
    ) : null;
  }

  return (
    <section
      aria-label={`${location.name} ${standardVault ? "vault" : "storage"} layout`}
      className="min-w-0 space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] p-3 sm:p-4"
    >
      <div className="flex flex-col flex-wrap items-start justify-between gap-2 sm:flex-row">
        <div className="min-w-0 flex-1 sm:basis-48">
          <h3 className="font-semibold text-[var(--app-text)]">
            {standardVault ? "Vault layout" : "Storage layout"}
          </h3>
          <p className="break-words text-sm text-[var(--app-text)]">
            {location.name}
          </p>
          <p className="text-xs text-[var(--app-muted)]">
            {total.toLocaleString()} cards ·{" "}
            {sections.some((section) => section.capacity !== null)
              ? `${room.toLocaleString()} spaces across ${sections.filter((section) => section.capacity !== null).length} sections with known capacity`
              : "Section capacities not set"}
          </p>
        </div>
        <a
          href={vaultSectionHref(location.id, null, query)}
          className="min-h-9 shrink-0 rounded px-2 py-1 text-sm text-[var(--app-link)] underline underline-offset-4"
          aria-current={activeSection === null ? "page" : undefined}
        >
          Browse all sections
        </a>
      </div>
      <p className="text-xs text-[var(--app-muted)]">
        {standardVault
          ? "Sections 0–5, left to right. Capacity is advisory: 85 physical cards per section."
          : "Configured sections, left to right. Capacity is advisory; existing card placements are unchanged."}
      </p>
      <div
        ref={scroller}
        className="overflow-x-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-3)] p-2"
        tabIndex={0}
        role="group"
        aria-label={
          standardVault
            ? "Six sections in a single row; scroll horizontally on small screens"
            : "Storage sections; scroll horizontally on small screens"
        }
      >
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, sections.length)}, minmax(5rem, 1fr))`,
            minWidth: `${Math.max(1, sections.length) * 5.625}rem`,
          }}
          data-vault-section-row
        >
          {sections.map((section) => {
            const over =
              section.capacity !== null && section.quantity > section.capacity;
            const available = Math.max(
              0,
              (section.capacity ?? 0) - section.quantity,
            );
            const active = activeSection === section.name;
            return (
              <div
                key={section.name}
                className={`flex min-w-0 flex-col gap-2 rounded-lg border p-2 ${active ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] ring-1 ring-[var(--app-accent)]" : over ? "border-amber-600 bg-[color-mix(in_srgb,var(--app-surface)_88%,#f59e0b)]" : "border-[var(--app-border)] bg-[var(--app-surface)]"}`}
              >
                <a
                  href={vaultSectionHref(location.id, section.name, query)}
                  aria-label={`${section.name}, ${spaceLabel(section)}. Browse cards.`}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-1 flex-col gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                >
                  <span className="text-sm font-semibold text-[var(--app-text)]">
                    {section.name}
                  </span>
                  <div
                    aria-hidden="true"
                    className="flex h-16 items-end overflow-hidden rounded border border-[var(--app-border)] bg-[var(--app-surface-3)]"
                  >
                    <div
                      className={`w-full ${over ? "bg-amber-500/70" : "bg-cyan-600/60"}`}
                      style={{
                        height:
                          section.capacity === null
                            ? "0%"
                            : `${Math.min(100, (section.quantity / section.capacity) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-[var(--app-text)]">
                    {section.quantity.toLocaleString()}
                    {section.capacity === null
                      ? " cards"
                      : ` / ${section.capacity.toLocaleString()}`}
                  </span>
                  <span
                    className={`text-xs ${over ? "text-[var(--app-text)]" : "text-[var(--app-text)]"}`}
                  >
                    {section.capacity === null
                      ? "Capacity not set"
                      : over
                        ? `${section.quantity - section.capacity} over capacity`
                        : available === 0
                          ? "Full"
                          : `${available} spaces left`}
                  </span>
                  {over ? (
                    <span className="text-xs text-[var(--app-text)]">
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
        aria-label={
          standardVault
            ? "Other placements in this vault"
            : "Other placements in this location"
        }
      >
        {[{ name: "", quantity: unsectioned }, ...extra].map((section) => (
          <div
            key={section.name}
            className={`min-w-32 max-w-full space-y-1 break-words rounded border px-2 py-1 ${activeSection === section.name ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]" : "border-[var(--app-border)]"}`}
          >
            <a
              href={vaultSectionHref(location.id, section.name, query)}
              aria-current={activeSection === section.name ? "page" : undefined}
              className="block min-h-9 py-1 text-sm text-[var(--app-link)] underline underline-offset-4"
            >
              {section.name || "Unsectioned"} ·{" "}
              {section.quantity.toLocaleString()} cards
            </a>
            {moveButton(section.name)}
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--app-muted)]">
        Counts include all cards directly in this location, regardless of search
        filters. Extra section names and unsectioned cards are kept.
      </p>
      {canMove ? (
        <p className="text-xs text-[var(--app-link)]">
          {selectedQuantity.toLocaleString()} cards selected. Choose Move here
          to review a move; browsing another section clears this selection.
        </p>
      ) : null}
    </section>
  );
}
