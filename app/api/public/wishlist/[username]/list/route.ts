import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getPublicWishlistBrowse } from "@/lib/public-wishlist-browser";
import { publicInventoryUsername } from "@/lib/public-inventory-link";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ username: string }> }) {
  const [{ username }, viewer] = await Promise.all([context.params, getCurrentUser()]);
  const result = await getPublicWishlistBrowse(prisma, publicInventoryUsername(username), Object.fromEntries(new URL(request.url).searchParams), viewer?.preferredPriceProvider);
  return Response.json(result ?? { error: "Wishlist unavailable" }, { status: result ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
