export default function InventoryLoading() {
  return (
    <main className="p-8 space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-zinc-800" />
      <div className="h-10 w-64 animate-pulse rounded bg-zinc-800" />
      <div className="rounded border border-zinc-800 p-4 space-y-3">
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="grid gap-2 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded bg-zinc-900"
            />
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <div
            key={index}
            className="aspect-[63/88] animate-pulse rounded bg-zinc-900"
          />
        ))}
      </div>
    </main>
  );
}
