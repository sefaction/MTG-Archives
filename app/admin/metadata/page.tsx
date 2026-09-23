import { AdminNav } from "@/components/admin/AdminNav";
export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { AdminMetadataRefreshPanel } from "@/components/AdminMetadataRefreshPanel";
import { AdminCommanderBracketPanel } from "@/components/AdminCommanderBracketPanel";
import { requireAdminMode } from "@/lib/auth";
import { getActiveCommanderBracketRuleSetSummary } from "@/lib/commander-brackets";

export default async function AdminMetadataPage() {
  await requireAdminMode();
  const activeRuleSet = await getActiveCommanderBracketRuleSetSummary();

  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-8">
      <Nav />
      <AdminNav active="metadata" />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Card metadata</h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          Refresh cached Scryfall card metadata for cards already present in
          inventory. Previewing does not change local inventory or cached card
          records; only selected accepted cards are updated.
        </p>
      </section>
      <AdminMetadataRefreshPanel />
      <AdminCommanderBracketPanel
        activeRuleSet={
          activeRuleSet
            ? {
                name: activeRuleSet.name,
                version: activeRuleSet.version,
                source: activeRuleSet.source,
                sourceUrl: activeRuleSet.sourceUrl,
                refreshedAt: activeRuleSet.refreshedAt.toISOString(),
                gameChangerCount: activeRuleSet._count.gameChangers,
              }
            : null
        }
      />
    </main>
  );
}
