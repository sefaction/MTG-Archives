export default function PublicInventoryLoading() {
  return (
    <main className="p-8 space-y-6">
      <div className="flex gap-4 border-b border-zinc-800 pb-4">
        <div className="h-5 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="h-5 w-24 animate-pulse rounded bg-zinc-800" />
        <div className="h-5 w-32 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="rounded border border-zinc-800 p-4 space-y-3">
        <div className="h-4 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="grid gap-2 md:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
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
