import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { publicWishlistPageUsername } from "@/lib/public-inventory-link";
import { getPublicWishlist, publicWishlistCategories } from "@/lib/public-wishlist";

export const dynamic = "force-dynamic";

export default async function PublicWishlistPage({ params }: { params: Promise<{ username: string }> }) {
  noStore();
  const { username } = await params;
  const wishlist = await getPublicWishlist(prisma, publicWishlistPageUsername(username));
  if (!wishlist) notFound();
  return (
    <main className="space-y-6 p-4 md:p-8">
      <Nav />
      <h1 className="break-words text-2xl font-semibold">{wishlist.username}&apos;s public Wishlist</h1>
      <p className="text-sm text-[var(--app-muted)]">Shared wishes, grouped by reason. Quantities for different reasons are tracked separately.</p>
      {wishlist.categories.length === 0 && <p>No Wishlist categories are shared.</p>}
      {publicWishlistCategories.filter(category => wishlist.categories.includes(category.value)).map(category => {
        const wishes = wishlist.wishes.filter(wish => wish.category === category.value);
        return <section key={category.value} aria-labelledby={`public-wishlist-${category.value}`} className="space-y-3">
          <h2 id={`public-wishlist-${category.value}`} className="text-xl font-semibold">{category.label}</h2>
          {wishes.length ? <ul className="divide-y divide-[var(--app-border)] rounded border border-[var(--app-border)]">
            {wishes.map((wish, index) => <li key={index} className="flex flex-wrap justify-between gap-3 p-3">
              <div className="min-w-0 break-words"><p className="font-medium">{wish.name}</p>
                <p className="text-sm text-[var(--app-muted)]">{wish.printing} · {wish.finish}</p></div>
              <p className="shrink-0">Wanted {wish.quantity}</p>
            </li>)}
          </ul> : <p className="text-sm text-[var(--app-muted)]">No wishes in this category.</p>}
        </section>;
      })}
    </main>
  );
}
