export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const filterPanelClass =
  "rounded border border-zinc-800 bg-zinc-950/40 p-3";

export const filterLabelClass = "text-xs font-medium text-zinc-300";

export const filterFieldClass = "block text-xs font-medium text-zinc-300";

export const filterInlineFieldClass =
  "inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 transition-colors focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30";

export const filterControlClass =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50";

export const filterInputClass = filterControlClass;

export const filterSelectClass = cn(filterControlClass, "pr-8");

export const filterOptionClass = "bg-zinc-900 text-zinc-100";

export const filterTextareaClass = cn(filterControlClass, "min-h-24");

export const filterButtonClass =
  "rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 transition-colors hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50";

export const filterPrimaryButtonClass =
  "rounded-md border border-sky-700 bg-sky-950/40 px-3 py-2 text-sm text-sky-100 transition-colors hover:bg-sky-950 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50";

export const filterDangerButtonClass =
  "rounded-md border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-100 transition-colors hover:bg-red-950/50 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50";
