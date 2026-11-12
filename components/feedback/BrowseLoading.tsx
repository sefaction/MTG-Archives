export function BrowseLoading({ label }: { label: string }) {
  return (
    <main
      className="min-w-0 space-y-4 p-4 sm:p-8"
      role="status"
      aria-live="polite"
    >
      <p>Loading {label}…</p>
      <div className="app-panel space-y-3 p-4" aria-hidden="true">
        <div className="h-8 w-1/2 rounded bg-[var(--app-border)] motion-safe:animate-pulse" />
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-10 rounded bg-[var(--app-border)] motion-safe:animate-pulse"
          />
        ))}
      </div>
    </main>
  );
}
