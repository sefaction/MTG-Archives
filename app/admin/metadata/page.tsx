export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { AdminMetadataRefreshPanel } from "@/components/AdminMetadataRefreshPanel";
import { requireAdminMode } from "@/lib/auth";

export default async function AdminMetadataPage() {
  await requireAdminMode();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Card metadata</h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          Refresh cached Scryfall card metadata for cards already present in
          inventory. Previewing does not change local inventory or cached card
          records; only selected accepted cards are updated.
        </p>
      </section>
      <AdminMetadataRefreshPanel />
    </main>
  );
}
