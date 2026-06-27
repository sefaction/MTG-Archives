export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const filterPanelClass =
  "rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_92%,transparent)] p-3 shadow-sm shadow-[var(--app-shadow)]";

export const filterLabelClass = "text-xs font-medium text-[var(--app-text)]";

export const filterFieldClass =
  "block text-xs font-medium text-[var(--app-text)]";

export const filterInlineFieldClass =
  "inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-control)] px-2 py-1 text-sm text-[var(--app-text)] transition-colors focus-within:border-[var(--app-accent)] focus-within:ring-2 focus-within:ring-[var(--app-focus)]";

export const filterControlClass =
  "rounded-md border border-[var(--app-border)] bg-[var(--app-control)] px-2 py-1.5 text-sm text-[var(--app-text)] outline-none transition-colors placeholder:text-[var(--app-muted)] hover:border-[var(--app-border-strong)] focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-focus)] disabled:cursor-not-allowed disabled:opacity-50";

export const filterInputClass = filterControlClass;

export const filterSelectClass = cn(filterControlClass, "pr-8");

export const filterOptionClass =
  "bg-[var(--app-control)] text-[var(--app-text)]";

export const filterTextareaClass = cn(filterControlClass, "min-h-24");

export const filterButtonClass =
  "rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-sm text-[var(--app-text)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface-3)] focus:outline-none focus:ring-2 focus:ring-[var(--app-focus)] disabled:cursor-not-allowed disabled:opacity-50";

export const filterPrimaryButtonClass =
  "rounded-md border border-[var(--app-accent)] bg-[var(--app-accent-soft)] px-3 py-2 text-sm font-medium text-[var(--app-accent-contrast)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--app-focus)] disabled:cursor-not-allowed disabled:opacity-50";

export const filterDangerButtonClass =
  "rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:border-red-600 hover:bg-red-950/50 focus:outline-none focus:ring-2 focus:ring-red-500/35 disabled:cursor-not-allowed disabled:opacity-50";
