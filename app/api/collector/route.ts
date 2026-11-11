import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectorCatalog, collectorSets } from "@/lib/collector-catalog";
import { readCollectorDetail, readCollectorProgress } from "@/lib/collector-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = {"Cache-Control": "private, no-store"};
  const user = await getCurrentUser();
  if (!user) return Response.json({error: "Sign in to view your collection."}, {status: 401, headers});
  if (!user.playerId) return Response.json({error: "Link your account to an inventory owner in Settings."}, {status: 403, headers});
  const params = new URL(request.url).searchParams;
  const set = params.get("set");
  const mode = params.get("detail");
  const page = Number(params.get("page") ?? 1);
  if (set !== null && !/^[a-z0-9]{2,8}$/.test(set))
    return Response.json({error: "Invalid set code."}, {status: 400, headers});
  if (mode !== null && (!set || (mode !== "grouped" && mode !== "variants") || !Number.isSafeInteger(page) || page < 1))
    return Response.json({error: "Invalid set detail request."}, {status: 400, headers});
  try {
    if (set) {
      const catalog = await collectorCatalog(set, request.signal);
      // Deck commitments are still InventoryItems. Do not exclude locations or
      // reservations, and never accept an owner ID from the browser/admin mode.
      if (mode === "grouped" || mode === "variants") {
        const detail = await readCollectorDetail(prisma, user.playerId, set, catalog.cards,
          {mode, page, missingOnly: params.get("missing") === "1"});
        const wishes = await prisma.collectorWishlistItem.findMany({
          where: {
            ownerUserId: user.id,
            setCode: set,
            mode,
            targetKey: {in: detail.rows.map(row => row.id)},
          },
          select: {targetKey: true},
        });
        return Response.json({
          set, ...detail, checkedAt: catalog.checkedAt,
          wishlistedIds: wishes.map(wish => wish.targetKey),
        }, {headers});
      }
      const progress = await readCollectorProgress(prisma, user.playerId, set, catalog.cards);
      return Response.json({set, ...progress,
        checkedAt: catalog.checkedAt}, {headers});
    }
    const ownedSets = await prisma.card.findMany({
      where: {inventoryItems: {some: {currentOwnerId: user.playerId, quantity: {gt: 0}, language: {equals: "en", mode: "insensitive"}}}},
      select: {setCode: true, setName: true}, distinct: ["setCode"],
    });
    let sets;
    let directoryUnavailable = false;
    try { sets = await collectorSets(); }
    catch { directoryUnavailable = true; sets = ownedSets.map(card => ({code: card.setCode, name: card.setName ?? card.setCode, set_type: "unknown", digital: false})); }
    const codes = new Set(ownedSets.map(card => card.setCode));
    return Response.json({sets: sets.map(set => ({...set, hasOwned: codes.has(set.code)})), directoryUnavailable}, {headers});
  } catch {
    return Response.json({error: "Complete set catalog unavailable. Retry to check progress; no percentage has been estimated."}, {status: 503, headers});
  }
}
