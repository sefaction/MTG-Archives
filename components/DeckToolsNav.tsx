import Link from "next/link";
import { cn } from "./filterStyles";

export type DeckToolPage = "builder" | "analysis" | "hands" | "playtest";

const tools: Array<{
  id: DeckToolPage;
  label: string;
  path: string;
  available: boolean;
}> = [
  { id: "builder", label: "Builder", path: "", available: true },
  { id: "analysis", label: "Analysis", path: "/analysis", available: true },
  { id: "hands", label: "Sample Hands", path: "/hands", available: false },
  { id: "playtest", label: "Playtest", path: "/playtest", available: false },
];

export function DeckToolsNav({
  deckId,
  active,
}: {
  deckId: string;
  active: DeckToolPage;
}) {
  return (
    <nav
      aria-label="Deck tools"
      className="app-panel flex flex-wrap items-center gap-2 p-2"
    >
      {tools.map((tool) =>
        tool.available ? (
          <Link
            key={tool.id}
            href={`/decks/${deckId}${tool.path}`}
            aria-current={active === tool.id ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition",
              active === tool.id
                ? "border-cyan-700 bg-cyan-950/60 text-cyan-100"
                : "border-[#2a332d] bg-[#0d1210] text-stone-300 hover:border-cyan-900 hover:text-cyan-100",
            )}
          >
            {tool.label}
          </Link>
        ) : (
          <span
            key={tool.id}
            aria-disabled="true"
            title="Planned in the Deck Building Tools roadmap"
            className="cursor-not-allowed rounded-md border border-[#252c28] bg-[#0b0f0d] px-3 py-2 text-sm text-stone-600"
          >
            {tool.label}
            <span className="ml-1 text-[10px] uppercase tracking-wide">
              soon
            </span>
          </span>
        ),
      )}
    </nav>
  );
}
