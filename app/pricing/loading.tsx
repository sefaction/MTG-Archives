export default function PricingLoading() {
  return (
    <main className="space-y-4 p-4 sm:p-8" role="status" aria-live="polite">
      <div className="h-12 rounded border border-zinc-800 bg-zinc-900/60" />
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
        Loading pricing data…
      </div>
    </main>
  );
}
