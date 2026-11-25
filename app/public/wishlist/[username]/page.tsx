import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import Link from "next/link";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { InventoryWorkspace } from "@/components/InventoryWorkspace";
import { InventoryQuickCardNameSearch } from "@/components/InventoryQuickCardNameSearch";
import { PublicWishlistCategoryFilter } from "@/components/PublicWishlistCategoryFilter";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { publicWishlistPageUsername, publicWishlistLink } from "@/lib/public-inventory-link";
import { publicWishlistCategories } from "@/lib/public-wishlist";
import { getPublicWishlistBrowse } from "@/lib/public-wishlist-browser";

export const dynamic = "force-dynamic";

export default async function PublicWishlistPage({ params, searchParams }: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const [{ username }, raw, viewer] = await Promise.all([params, searchParams, getCurrentUser()]);
  const wishlist = await getPublicWishlistBrowse(prisma, publicWishlistPageUsername(username), raw, viewer?.preferredPriceProvider);
  if (!wishlist) notFound();
  const actionPath = publicWishlistLink(wishlist.username), apiBase = `/api${actionPath}`;
  const browseParams = Object.fromEntries(Object.entries(wishlist.params).map(([key, value]) => [key, String(value)]));
  const query = new URLSearchParams(browseParams); query.delete("page");
  const clear = new URLSearchParams(query); clear.delete("cardName"); clear.delete("category");
  const clearHref = `${actionPath}?${clear}`;
  return <main className="min-w-0 space-y-4 p-4 sm:p-8">
    <nav aria-label="Collection navigation" className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold">MTG Archives</span><Link href="/login" className="underline">Log in</Link>
    </nav>
    <header className="space-y-2">
      <h1 className="break-words text-3xl font-bold">{wishlist.username}&apos;s public Wishlist</h1>
      <p className="text-zinc-400">Shared wishes by reason. Each reason keeps its own wanted quantity.</p>
    </header>
    {wishlist.categories.length === 0 ? <p>No Wishlist categories are shared.</p> : <InventoryWorkspace cardName={wishlist.params.cardName}>
      <InventoryQuickCardNameSearch actionPath={actionPath} suggestionsEndpoint={`${apiBase}/filter-suggestions`} params={browseParams} />
      <PublicWishlistCategoryFilter actionPath={actionPath} query={query.toString()} category={wishlist.params.category}
        categories={publicWishlistCategories.filter(category => wishlist.categories.includes(category.value))
          .map(category => ({ value: category.value, label: category.label, count: wishlist.categoryCounts[category.value] ?? 0 }))} />
      <div className="inventory-results">
        <p className="inventory-result-summary">{wishlist.totalMatchingCount.toLocaleString()} wishes · {wishlist.totalMatchingCards.toLocaleString()} requested copies</p>
        {!wishlist.rows.length ? <div className="rounded border border-zinc-800 p-4 text-zinc-400">
          <p>No wishes in this category.</p><Link href={clearHref} className="mt-2 inline-block underline">Clear filters</Link>
        </div> : null}
        <InventoryBrowser rows={wishlist.rows} players={[]} locations={[]} cardLabels={{}} isAdmin={false}
          uiMode="public-readonly" collectionKind="wishlist" displayMode="exact" showPricing={wishlist.showPricing}
          totalMatchingCount={wishlist.totalMatchingCount} totalMatchingCards={wishlist.totalMatchingCards}
          currentPage={wishlist.page} totalPages={wishlist.totalPages} hasNextPage={wishlist.hasNextPage} hasPreviousPage={wishlist.page > 1}
          pageHrefBase={query.toString()} sortActionPath={actionPath} infiniteApiPath={`${apiBase}/list`}
          initialPageSize={wishlist.params.pageSize} initialBrowsingMode={wishlist.params.browse}
          initialSortField={wishlist.params.sort} initialSortDirection={wishlist.params.sortDir} />
      </div>
    </InventoryWorkspace>}
  </main>;
}
