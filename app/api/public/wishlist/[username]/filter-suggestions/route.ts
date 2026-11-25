import { prisma } from "@/lib/prisma";
import { getPublicWishlistReferences } from "@/lib/public-wishlist";
import { publicWishlistPageUsername } from "@/lib/public-inventory-link";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  const query = new URL(request.url).searchParams;
  const view = await getPublicWishlistReferences(prisma, publicWishlistPageUsername(username));
  if (!view) return Response.json({ error: "Wishlist unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const name = (query.get("q") ?? "").trim().slice(0, 120).toLocaleLowerCase(), category = query.get("category");
  const names = name && query.get("kind") === "cardName" ? [...new Set(view.wishes.filter(wish =>
    (!category || category === "all" || wish.category === category) && wish.name.toLocaleLowerCase().includes(name)).map(wish => wish.name))].sort((a, b) => a.localeCompare(b)) : [];
  return Response.json({ suggestions: names.slice(0, 12).map(value => ({ value, label: value })) }, { headers: { "Cache-Control": "no-store" } });
}
