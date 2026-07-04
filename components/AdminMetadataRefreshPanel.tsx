"use client";

import { useState } from "react";
import { cn, filterPrimaryButtonClass } from "./filterStyles";

type RefreshResult = {
  totalCards: number;
  refreshed: number;
  relatedRefreshed: number;
  notFound: number;
  errors: Array<{ batchStart: number; message: string }>;
};

export function AdminMetadataRefreshPanel() {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RefreshResult | null>(null);

  async function refreshAll() {
    setRefreshing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/card-metadata/refresh-all", {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Metadata refresh failed.");
      setResult(body);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Metadata refresh failed.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="space-y-4 rounded border border-zinc-800 p-4">
      <div>
        <h2 className="text-xl font-semibold">Refresh card metadata</h2>
        <p className="text-sm text-zinc-400">
          Refresh all cached card records from Scryfall. This updates card
          metadata such as faces, images, legalities, prices, and meld
          relationships. Inventory quantities, locations, decks, and user data
          are not changed.
        </p>
      </div>

      <button
        type="button"
        onClick={refreshAll}
        disabled={refreshing}
        className={cn(filterPrimaryButtonClass, "px-3 py-2")}
      >
        {refreshing
          ? "Refreshing card metadata..."
          : "Refresh all card metadata"}
      </button>

      {error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
          <p>
            Refreshed {result.refreshed} of {result.totalCards} cached cards.
          </p>
          <p className="mt-1 text-zinc-300">
            Refreshed {result.relatedRefreshed} related card records for meld
            parts, meld results, tokens, and other Scryfall relationships.
          </p>
          {result.notFound ? (
            <p className="mt-1 text-amber-100">
              {result.notFound} cached Scryfall IDs were not found upstream.
            </p>
          ) : null}
          {result.errors.length ? (
            <div className="mt-2 text-red-100">
              {result.errors.length} batches failed. Try again to retry failed
              batches.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
