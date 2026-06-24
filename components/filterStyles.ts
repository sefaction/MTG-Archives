export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const filterPanelClass =
  "rounded-lg border border-[#2a332d] bg-[#111715]/90 p-3 shadow-sm shadow-black/20";

export const filterLabelClass = "text-xs font-medium text-stone-300";

export const filterFieldClass = "block text-xs font-medium text-stone-300";

export const filterInlineFieldClass =
  "inline-flex min-h-10 items-center gap-2 rounded-md border border-[#364139] bg-[#0d1210] px-2 py-1 text-sm text-stone-100 transition-colors focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/25";

export const filterControlClass =
  "rounded-md border border-[#364139] bg-[#0d1210] px-2 py-1.5 text-sm text-stone-100 outline-none transition-colors placeholder:text-stone-500 hover:border-[#4a584d] focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50";

export const filterInputClass = filterControlClass;

export const filterSelectClass = cn(filterControlClass, "pr-8");

export const filterOptionClass = "bg-[#0d1210] text-stone-100";

export const filterTextareaClass = cn(filterControlClass, "min-h-24");

export const filterButtonClass =
  "rounded-md border border-[#364139] bg-[#111715] px-3 py-2 text-sm text-stone-100 transition-colors hover:border-[#4a584d] hover:bg-[#17201b] focus:outline-none focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50";

export const filterPrimaryButtonClass =
  "rounded-md border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-500 hover:bg-cyan-900/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50";

export const filterDangerButtonClass =
  "rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:border-red-600 hover:bg-red-950/50 focus:outline-none focus:ring-2 focus:ring-red-500/35 disabled:cursor-not-allowed disabled:opacity-50";
