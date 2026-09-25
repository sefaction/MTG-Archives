"use client";

import { useState } from "react";
import type { PricingHistoryTotals as Totals } from "@/lib/pricing-db-query";

export function PricingHistoryTotals() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pricing/history-totals", {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "Unable to load history totals. Confirm Admin mode, check worker health, and try again.",
        );
      setTotals(await response.json());
    } catch {
      setError(
        "Unable to load history totals. Confirm Admin mode, check worker health, and try again.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <section
      className="min-w-0 rounded border border-[var(--app-border)] p-4"
      aria-labelledby="history-totals-title"
    >
      <h2 id="history-totals-title" className="text-lg font-semibold">
        Historical price coverage
      </h2>
      <p className="app-muted mt-1 text-sm">
        Calculate exact history totals on demand. This may take up to a minute;
        other admin tasks remain available. Results are cached for up to five
        minutes.
      </p>
      <button
        onClick={load}
        disabled={loading}
        className="mt-3 rounded border border-cyan-700 px-3 py-2 text-sm"
      >
        {loading ? "Calculating history totals…" : "Load history totals"}
      </button>
      {loading ? (
        <p role="status" className="app-muted mt-2 text-sm">
          Calculating; worker health and job controls remain available.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {!totals && !loading && !error ? (
        <p className="app-muted mt-2 text-sm">
          History totals have not been loaded.
        </p>
      ) : null}
      {totals ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="app-muted">Historical snapshots</dt>
            <dd>{totals.snapshotCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="app-muted">Priced printings</dt>
            <dd>{totals.pricedCardCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="app-muted">Latest observed price</dt>
            <dd>{totals.latestObservedDate || "No observations"}</dd>
          </div>
          <div>
            <dt className="app-muted">Latest ingested</dt>
            <dd>{totals.latestIngestedAt || "No ingestion recorded"}</dd>
          </div>
          <div>
            <dt className="app-muted">Calculated</dt>
            <dd>{new Date(totals.calculatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
