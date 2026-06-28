"use client";

import { useState } from "react";
import {
  cn,
  filterButtonClass,
  filterPrimaryButtonClass,
} from "./filterStyles";

type ActiveRuleSet = {
  name: string;
  version: string;
  source: string;
  sourceUrl: string | null;
  refreshedAt: string;
  gameChangerCount: number;
} | null;

type RefreshResult = {
  ruleSetId: string;
  name: string;
  version: string;
  source: string;
  sourceUrl: string | null;
  gameChangerCount: number;
};

export function AdminCommanderBracketPanel({
  activeRuleSet,
}: {
  activeRuleSet: ActiveRuleSet;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RefreshResult | null>(null);

  async function refreshBrackets() {
    setRefreshing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/commander-brackets/refresh", {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Commander bracket refresh failed.");
      }
      setResult(body);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Commander bracket refresh failed.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  const visibleRuleSet = result
    ? {
        ...result,
        refreshedAt: "just now",
      }
    : activeRuleSet;

  return (
    <section className="space-y-4 rounded border border-zinc-800 p-4">
      <div>
        <h2 className="text-xl font-semibold">Commander bracket metadata</h2>
        <p className="text-sm text-zinc-400">
          Refresh the active Commander bracket ruleset and Game Changer card
          list. Deck suggestions will use this stored metadata instead of
          hard-coded card names.
        </p>
      </div>

      {visibleRuleSet ? (
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Ruleset
            </p>
            <p className="font-medium">{visibleRuleSet.name}</p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Version
            </p>
            <p className="font-medium">{visibleRuleSet.version}</p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Game Changers
            </p>
            <p className="font-medium">{visibleRuleSet.gameChangerCount}</p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Source
            </p>
            <p className="font-medium">{visibleRuleSet.source}</p>
          </div>
        </div>
      ) : (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
          No active Commander bracket ruleset has been refreshed yet.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={refreshBrackets}
          disabled={refreshing}
          className={cn(filterPrimaryButtonClass, "px-3 py-2")}
        >
          {refreshing
            ? "Refreshing bracket metadata..."
            : "Refresh bracket metadata"}
        </button>
        {visibleRuleSet?.sourceUrl ? (
          <a
            className={cn(filterButtonClass, "px-3 py-2")}
            href={visibleRuleSet.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View source
          </a>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        Optional source override: set COMMANDER_BRACKET_RULESET_URL to a JSON
        ruleset. Without it, refresh uses the Scryfall search query from
        COMMANDER_BRACKET_SCRYFALL_QUERY, defaulting to is:gamechanger.
      </p>

      {error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {result ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
          Refreshed {result.gameChangerCount} Game Changer cards for{" "}
          {result.name} ({result.version}).
        </p>
      ) : null}
    </section>
  );
}
