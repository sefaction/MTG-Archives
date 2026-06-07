export const dynamic = "force-dynamic";
import {
  getAccessScope,
  getCurrentUser,
  requireAdminMode,
  requireLogin,
} from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { resolveInventoryVisibility } from "@/lib/visibility";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import {
  DefaultCollectionVisibility,
  FoilStatus,
  InventorySourceType,
} from "@prisma/client";
import {
  searchLocalThenScryfallCards,
  upsertScryfallCard,
} from "@/lib/card-import";
import { formatScryfallError, getCardByScryfallIdResult } from "@/lib/scryfall";
import { revalidatePath } from "next/cache";
import { cleanupZeroQuantityInventory, deleteInventoryItem } from "./actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  ensureDefaultLocation,
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  getLocationsForOwner,
  orderInventoryItemsByPageGroups,
  bulkMoveInventoryToLocation,
  bulkDeleteInventoryItems,
} from "@/lib/inventory-locations";
import { getManaFacesForDto } from "@/lib/mtg/mana-display";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  const userWithPlayer = user;
  const accessScope = user ? await getAccessScope(user) : null;
  const adminModeActive = accessScope?.mode === "admin";

  const p = await searchParams;
  const where: any = { quantity: { gt: 0 } };
  if (p.cardName) {
    const search = p.cardName.trim();
    where.OR = [
      { card: { name: { contains: search, mode: "insensitive" } } },
      { card: { setCode: { contains: search.toLowerCase() } } },
      { card: { setName: { contains: search, mode: "insensitive" } } },
      { card: { collectorNumber: { contains: search, mode: "insensitive" } } },
      { card: { typeLine: { contains: search, mode: "insensitive" } } },
      { location: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (p.oracleText)
    where.card = {
      ...(where.card || {}),
      oracleText: { contains: p.oracleText, mode: "insensitive" },
    };
  if (p.typeLine)
    where.card = {
      ...(where.card || {}),
      typeLine: { contains: p.typeLine, mode: "insensitive" },
    };
  if (!adminModeActive) {
    where.currentOwnerId = userWithPlayer?.playerId || "__no_owner__";
  } else if (p.ownerId) {
    where.currentOwnerId = p.ownerId;
  }
  if (p.locationId) where.locationId = p.locationId;
  if (p.hasLocation === "unassigned")
    where.location = { normalizedName: "unassigned" };
  if (p.set)
    where.card = { ...(where.card || {}), setCode: p.set.toLowerCase() };
  if (p.rarity) where.card = { ...(where.card || {}), rarity: p.rarity };
  if (p.foil === "true") where.foil = true;
  if (p.foil === "false") where.foil = false;
  if (p.visibility === "public") {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { location: { visibility: "PUBLIC" } },
          {
            location: { visibility: "INHERIT" },
            currentOwner: {
              users: { some: { inventoryDefaultVisibility: "PUBLIC" } },
            },
          },
          {
            locationId: null,
            currentOwner: {
              users: { some: { inventoryDefaultVisibility: "PUBLIC" } },
            },
          },
        ],
      },
    ];
  }
  if (p.visibility === "private") {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { location: { visibility: "PRIVATE" } },
          {
            location: { visibility: "INHERIT" },
            currentOwner: {
              users: { some: { inventoryDefaultVisibility: "PRIVATE" } },
            },
          },
          {
            locationId: null,
            currentOwner: {
              users: { some: { inventoryDefaultVisibility: "PRIVATE" } },
            },
          },
        ],
      },
    ];
  }
  if (p.visibility === "inherit") {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ location: { visibility: "INHERIT" } }, { locationId: null }] },
    ];
  }
  if (p.manaValueMin || p.manaValueMax)
    where.card = {
      ...(where.card || {}),
      manaValue: {
        gte: p.manaValueMin ? Number(p.manaValueMin) : undefined,
        lte: p.manaValueMax ? Number(p.manaValueMax) : undefined,
      },
    };
  const colorIdentityNeedle = p.colorIdentity?.trim().toUpperCase();
  const keywordNeedle = p.keyword?.trim().toLowerCase();
  const priceMin = p.priceMin ? Number(p.priceMin) : undefined;
  const priceMax = p.priceMax ? Number(p.priceMax) : undefined;

  const displayMode: "exact" | "grouped" =
    p.displayMode === "grouped" ? "grouped" : "exact";
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const initialPageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const initialBrowsingMode: "paginated" | "infinite" =
    p.browse === "infinite" ? "infinite" : "paginated";
  const sortField = p.sort || "cardName";
  const sortDirection: "asc" | "desc" = p.sortDir === "desc" ? "desc" : "asc";
  const currentPage =
    initialBrowsingMode === "infinite"
      ? 1
      : Math.max(1, Number(p.page || "1") || 1);
  const queryPageSize = initialPageSize;
  const querySkip = (currentPage - 1) * queryPageSize;
  const inventoryQueryStartedAt = process.hrtime.bigint();

  const exactGroupBy = {
    by: [
      "currentOwnerId",
      "cardId",
      "foilStatus",
      "condition",
      "language",
    ] as any,
    where,
    _sum: { quantity: true as const },
    _count: { _all: true as const },
    orderBy: [
      { cardId: "asc" },
      { currentOwnerId: "asc" },
      { foilStatus: "asc" },
      { condition: "asc" },
      { language: "asc" },
    ] as any,
  };
  const groupedGroupBy = {
    by: ["cardId"] as any,
    where,
    _sum: { quantity: true as const },
    _count: { _all: true as const },
    orderBy: [{ cardId: "asc" }] as any,
  };

  const [allGroups, players, zeroQuantityCount] = await Promise.all([
    displayMode === "grouped"
      ? prisma.inventoryItem.groupBy(groupedGroupBy)
      : prisma.inventoryItem.groupBy(exactGroupBy),
    prisma.player.findMany({ orderBy: { displayName: "asc" } }),
    adminModeActive
      ? prisma.inventoryItem.count({ where: { quantity: { lte: 0 } } })
      : Promise.resolve(0),
  ]);
  const cardSortData = await prisma.card.findMany({
    where: {
      id: {
        in: Array.from(
          new Set((allGroups as any[]).map((group) => group.cardId)),
        ),
      },
    },
    select: {
      id: true,
      name: true,
      setCode: true,
      rarity: true,
      manaValue: true,
      prices: true,
      colorIdentity: true,
      keywords: true,
    },
  });
  const cardSortById = new Map(cardSortData.map((card) => [card.id, card]));
  const compareValues = (left: any, right: any) => {
    if (typeof left === "number" || typeof right === "number") {
      return (Number(left) || 0) - (Number(right) || 0);
    }
    return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  };
  const groupMatchesClientSafeFilters = (group: any) => {
    const card = cardSortById.get(group.cardId) as any;
    const colorIdentityNeedle = p.colorIdentity?.trim().toUpperCase();
    const keywordNeedle = p.keyword?.trim().toLowerCase();
    const priceMin = p.priceMin ? Number(p.priceMin) : undefined;
    const priceMax = p.priceMax ? Number(p.priceMax) : undefined;
    if (colorIdentityNeedle) {
      const colorIdentity = Array.isArray(card?.colorIdentity)
        ? card.colorIdentity.join(",")
        : JSON.stringify(card?.colorIdentity ?? "");
      if (!colorIdentity.toUpperCase().includes(colorIdentityNeedle))
        return false;
    }
    if (keywordNeedle) {
      const keywords = Array.isArray(card?.keywords)
        ? card.keywords.join(", ")
        : JSON.stringify(card?.keywords ?? "");
      if (!keywords.toLowerCase().includes(keywordNeedle)) return false;
    }
    const usdPrice = card?.prices?.usd ? Number(card.prices.usd) : undefined;
    if (
      priceMin !== undefined &&
      (usdPrice === undefined || Number.isNaN(usdPrice) || usdPrice < priceMin)
    )
      return false;
    if (
      priceMax !== undefined &&
      (usdPrice === undefined || Number.isNaN(usdPrice) || usdPrice > priceMax)
    )
      return false;
    return true;
  };
  const sortValue = (group: any) => {
    const card = cardSortById.get(group.cardId) as any;
    if (sortField === "quantity") return group._sum?.quantity ?? 0;
    if (sortField === "setCode") return card?.setCode ?? "";
    if (sortField === "rarity") return card?.rarity ?? "";
    if (sortField === "manaValue") return card?.manaValue ?? 0;
    if (sortField === "priceUsd") return Number(card?.prices?.usd ?? 0);
    return card?.name ?? "";
  };
  const filteredGroups = (allGroups as any[]).filter(
    groupMatchesClientSafeFilters,
  );
  const sortedGroups = [...filteredGroups].sort((left, right) => {
    const direction = sortDirection === "desc" ? -1 : 1;
    const primary =
      compareValues(sortValue(left), sortValue(right)) * direction;
    if (primary) return primary;
    return compareValues(left.cardId, right.cardId);
  });
  const pageGroups = sortedGroups.slice(querySkip, querySkip + queryPageSize);
  const totalMatchingCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalMatchingCount / queryPageSize));

  const pageGroupWhere =
    displayMode === "grouped"
      ? {
          ...where,
          cardId: { in: (pageGroups as any[]).map((group) => group.cardId) },
        }
      : {
          ...where,
          OR: (pageGroups as any[]).map((group) => ({
            currentOwnerId: group.currentOwnerId,
            cardId: group.cardId,
            foilStatus: group.foilStatus,
            condition: group.condition,
            language: group.language,
          })),
        };

  const items = pageGroups.length
    ? await prisma.inventoryItem.findMany({
        where: pageGroupWhere,
        include: {
          card: true,
          currentOwner: true,
          location: true,
        },
        orderBy: [{ card: { name: "asc" } }, { createdAt: "desc" }],
      })
    : [];
  const inventoryQueryMs =
    Number(process.hrtime.bigint() - inventoryQueryStartedAt) / 1_000_000;
  if (inventoryQueryMs > 1000 || items.length > queryPageSize * 10) {
    console.warn("[inventory-list] server-side page query diagnostics", {
      elapsedMs: inventoryQueryMs,
      displayMode,
      currentPage,
      pageSize: queryPageSize,
      sortField,
      sortDirection,
      firstReturnedCardName:
        cardSortById.get(pageGroups[0]?.cardId)?.name ?? null,
      rowsReturned: pageGroups.length,
      rawRowsHydratedForVisibleGroups: items.length,
      totalMatchingCount,
    });
  }
  if (pageGroups.length > queryPageSize) {
    console.warn(
      "[inventory-list] query returned more rows than requested page size",
      {
        rowsReturned: pageGroups.length,
        pageSize: queryPageSize,
      },
    );
  }
  const ownerUsers = await prisma.user.findMany({
    where: {
      playerId: { in: Array.from(new Set(players.map((player) => player.id))) },
    },
    select: { playerId: true, inventoryDefaultVisibility: true },
  });
  const inventoryDefaultByPlayer = Object.fromEntries(
    ownerUsers
      .filter((ownerUser) => ownerUser.playerId)
      .map((ownerUser) => [
        ownerUser.playerId!,
        ownerUser.inventoryDefaultVisibility,
      ]),
  );

  const activeOwnerId =
    p.ownerId || (!adminModeActive ? userWithPlayer?.playerId || "" : "");
  const visiblePlayers = adminModeActive
    ? players
    : players.filter((player) => player.id === userWithPlayer?.playerId);
  const locations = activeOwnerId
    ? await getLocationsForOwner(prisma, activeOwnerId)
    : await prisma.inventoryLocation.findMany({
        orderBy: [{ ownerPlayer: { displayName: "asc" } }, { name: "asc" }],
      });

  const cardLabels = Object.fromEntries(
    items.map((item) => [
      item.cardId,
      `${item.card.name} (${item.card.setCode.toUpperCase()}) #${item.card.collectorNumber}`,
    ]),
  );

  async function onSearchPrintings(fd: FormData) {
    "use server";
    await requireAdminMode();
    const q = String(fd.get("q") || "");
    const r = await searchLocalThenScryfallCards(q);
    return r.cards.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      set: c.set,
      set_name: c.set_name,
      collector_number: c.collector_number,
      rarity: c.rarity,
      image_uris: c.image_uris,
    }));
  }

  async function onSaveEdit(fd: FormData) {
    "use server";
    const actionUser = await requireLogin();
    const actionScope = await getAccessScope(actionUser);
    const actionIsAdmin = actionScope?.mode === "admin";
    const inventoryItemId = String(fd.get("inventoryItemId") || "");
    const quantity = Number(fd.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new Error("Quantity must be a positive integer");

    const before = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!before) throw new Error("Inventory item not found");
    if (!actionIsAdmin) {
      if (!actionUser.playerId) {
        throw new Error("Your account is not linked to an inventory owner.");
      }
      if (before.currentOwnerId !== actionUser.playerId) {
        throw new Error("You can only edit inventory you own.");
      }
    }

    const submittedOwnerId = String(fd.get("currentOwnerId") || "");
    const currentOwnerId = actionIsAdmin
      ? submittedOwnerId
      : before.currentOwnerId;
    if (!currentOwnerId) throw new Error("Current owner is required");
    if (
      !actionIsAdmin &&
      submittedOwnerId &&
      submittedOwnerId !== currentOwnerId
    ) {
      throw new Error("You cannot change the current owner.");
    }

    let cardId = before.cardId;
    const newScryfallId = actionIsAdmin
      ? String(fd.get("newScryfallId") || "")
      : "";
    if (newScryfallId) {
      const existing = await prisma.card.findUnique({
        where: { scryfallId: newScryfallId },
      });
      if (existing) {
        cardId = existing.id;
      } else {
        const cardResult = await getCardByScryfallIdResult(newScryfallId);
        if (!cardResult.ok)
          throw new Error(formatScryfallError(cardResult.error));
        const created = await upsertScryfallCard(cardResult.data);
        cardId = created.id;
      }
    }

    const foilStatus = String(fd.get("foilStatus") || "NONFOIL") as FoilStatus;
    const locationIdRaw = String(fd.get("locationId") || "");
    const defaultLocation = await ensureDefaultLocation(prisma, currentOwnerId);
    const targetLocationId = locationIdRaw || defaultLocation.id;
    const targetLocation = await prisma.inventoryLocation.findUnique({
      where: { id: targetLocationId },
    });
    if (!targetLocation || targetLocation.ownerPlayerId !== currentOwnerId) {
      throw new Error(
        "Selected location does not belong to the current owner.",
      );
    }

    const updated = await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        currentOwnerId,
        quantity,
        foilStatus,
        foil: foilStatus !== FoilStatus.NONFOIL,
        condition: String(fd.get("condition") || before.condition),
        language: String(fd.get("language") || before.language || "EN"),
        locationId: targetLocationId,
        notes: String(fd.get("notes") || "") || null,
        sourceType: actionIsAdmin
          ? (String(
              fd.get("sourceType") || "CORRECTION",
            ) as InventorySourceType)
          : before.sourceType,
        cardId,
      },
    });

    await prisma.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: actionUser.id,
        changeType: actionIsAdmin
          ? newScryfallId
            ? "printing_correction"
            : "admin_inventory_correction"
          : "user_inventory_edit",
        beforeJson: before as any,
        afterJson: updated as any,
        reason: String(fd.get("reason") || "") || null,
      },
    });

    revalidatePath("/inventory");
  }

  async function onBulkMoveLocation(fd: FormData) {
    "use server";
    const actionUser = await requireLogin();
    const actionScope = await getAccessScope(actionUser);
    const actionIsAdmin = actionScope?.mode === "admin";
    const fieldNames = Array.from(new Set(Array.from(fd.keys()).map(String)));
    const destinationLocationId = String(fd.get("destinationLocationId") || "");
    const clientDestinationLocationId = String(
      fd.get("clientDestinationLocationId") || "",
    );
    const selectionMode = String(fd.get("selectionMode") || "selected");
    const reason = String(fd.get("reason") || "Bulk location move.");
    const sourceLocationIdRaw = String(fd.get("sourceLocationId") || "");
    let itemIds: string[] = [];
    try {
      itemIds = JSON.parse(String(fd.get("itemIds") || "[]")) as string[];
    } catch (error) {
      console.error("[bulk-location-move] failed to parse selected item IDs", {
        fieldNames,
        error,
      });
      return {
        success: false as const,
        message: "Selected inventory IDs were not submitted correctly.",
      };
    }

    console.info("[bulk-location-move] submit received", {
      fieldNames,
      destinationReceived: Boolean(destinationLocationId),
      destinationLocationId,
      clientDestinationLocationId,
      destinationMismatch:
        Boolean(clientDestinationLocationId) &&
        clientDestinationLocationId !== destinationLocationId,
      selectionMode,
      allMatchingFilters: selectionMode === "all",
      selectedItemCount: itemIds.length,
      sourceLocationId: sourceLocationIdRaw || null,
      filters: where,
    });

    try {
      if (!actionIsAdmin && !actionUser.playerId) {
        return {
          success: false as const,
          message: "Your account is not linked to an inventory owner.",
        };
      }
      if (displayMode !== "exact") {
        return {
          success: false as const,
          message: "Bulk editing is available in Exact printings mode.",
        };
      }
      if (!destinationLocationId) {
        console.warn("[bulk-location-move] destination missing server-side", {
          fieldNames,
          clientDestinationLocationId,
        });
        return {
          success: false as const,
          message: "Choose a destination location before moving cards.",
        };
      }

      const destination = await prisma.inventoryLocation.findUnique({
        where: { id: destinationLocationId },
        select: { id: true, ownerPlayerId: true, name: true },
      });
      console.info("[bulk-location-move] destination lookup", {
        destinationLocationId,
        found: Boolean(destination),
        ownerPlayerId: destination?.ownerPlayerId ?? null,
        destinationName: destination?.name ?? null,
      });
      if (!destination) {
        return {
          success: false as const,
          message: "The selected destination location no longer exists.",
        };
      }

      const allowedOwnerId = actionIsAdmin
        ? destination.ownerPlayerId
        : actionUser.playerId || undefined;
      const previewWhere: any =
        selectionMode === "all" ? { ...where } : { id: { in: itemIds } };
      previewWhere.quantity = { gt: 0 };
      if (sourceLocationIdRaw) previewWhere.locationId = sourceLocationIdRaw;
      if (allowedOwnerId) previewWhere.currentOwnerId = allowedOwnerId;
      const preview = await prisma.inventoryItem.aggregate({
        where: previewWhere,
        _count: { _all: true },
        _sum: { quantity: true as const },
      });
      console.info("[bulk-location-move] matched rows preview", {
        matchedInventoryRows: preview._count._all,
        matchedLocationQuantityRows: preview._count._all,
        matchedPhysicalCards: preview._sum.quantity ?? 0,
        allowedOwnerId: allowedOwnerId ?? null,
      });

      console.info("[bulk-location-move] mutation starting", {
        destinationLocationId,
        selectionMode,
      });
      const result = await bulkMoveInventoryToLocation(prisma, {
        actorUserId: actionUser.id,
        destinationLocationId,
        itemIds: selectionMode === "all" ? undefined : itemIds,
        where: selectionMode === "all" ? where : undefined,
        allowedOwnerId,
        sourceLocationId: sourceLocationIdRaw || undefined,
        reason,
      });
      console.info("[bulk-location-move] mutation committed", result);
      console.info("[bulk-location-move] revalidation starting", {
        paths: ["/inventory", "/locations"],
      });
      revalidatePath("/inventory");
      revalidatePath("/locations");
      return { success: true as const, ...result };
    } catch (error: any) {
      console.error("[bulk-location-move] failed", {
        message: error?.message,
        stack: error?.stack,
        destinationLocationId,
        selectionMode,
        sourceLocationId: sourceLocationIdRaw || null,
      });
      const rawMessage = String(error?.message || "");
      const isTransactionTimeout =
        rawMessage.includes("Transaction already closed") ||
        rawMessage.includes("expired transaction") ||
        rawMessage.includes("interactive transaction timeout");
      const exposesPrismaInternals =
        rawMessage.includes("Invalid `prisma.") ||
        rawMessage.includes("Transaction API error") ||
        rawMessage.includes("PrismaClient");
      return {
        success: false as const,
        message: isTransactionTimeout
          ? "Bulk move took too long and was rolled back. Try a smaller selection, or use a background bulk move workflow once available."
          : exposesPrismaInternals || !rawMessage
            ? "Bulk move failed before any inventory changes were committed. Check the server logs for the diagnostic bulk-location-move entry."
            : rawMessage,
      };
    }
  }

  async function onBulkDeleteInventory(fd: FormData) {
    "use server";
    const actionUser = await requireLogin();
    const actionScope = await getAccessScope(actionUser);
    const actionIsAdmin = actionScope?.mode === "admin";
    const selectionMode = String(fd.get("selectionMode") || "selected");
    const sourceLocationIdRaw = String(fd.get("sourceLocationId") || "");
    const reason = String(fd.get("reason") || "Inventory deleted.").trim();
    const confirmDelete = String(fd.get("confirmDelete") || "").trim();
    let itemIds: string[] = [];
    try {
      itemIds = JSON.parse(String(fd.get("itemIds") || "[]")) as string[];
    } catch (error) {
      console.error("[bulk-inventory-delete] failed to parse selected IDs", {
        error,
      });
      return {
        success: false as const,
        message: "Selected inventory IDs were not submitted correctly.",
      };
    }

    try {
      if (!actionIsAdmin && !actionUser.playerId) {
        return {
          success: false as const,
          message: "Your account is not linked to an inventory owner.",
        };
      }
      if (displayMode !== "exact") {
        return {
          success: false as const,
          message:
            "Bulk delete is available in Exact printings mode so you can choose specific printings.",
        };
      }
      if (selectionMode !== "all" && !itemIds.length) {
        return {
          success: false as const,
          message: "Choose inventory to delete.",
        };
      }
      if (actionIsAdmin && !p.ownerId && selectionMode === "all") {
        return {
          success: false as const,
          message:
            "Filter to one current owner before deleting all matching inventory in Admin Mode.",
        };
      }
      const allowedOwnerId = actionIsAdmin
        ? p.ownerId || undefined
        : actionUser.playerId || undefined;
      const previewWhere: any =
        selectionMode === "all" ? { ...where } : { id: { in: itemIds } };
      previewWhere.quantity = { gt: 0 };
      if (sourceLocationIdRaw) previewWhere.locationId = sourceLocationIdRaw;
      if (allowedOwnerId) previewWhere.currentOwnerId = allowedOwnerId;
      const preview = await prisma.inventoryItem.aggregate({
        where: previewWhere,
        _count: { _all: true },
        _sum: { quantity: true as const },
      });
      console.info("[bulk-inventory-delete] matched rows preview", {
        selectionMode,
        sourceLocationId: sourceLocationIdRaw || null,
        matchedInventoryRows: preview._count._all,
        matchedPhysicalCards: preview._sum.quantity ?? 0,
        allowedOwnerId: allowedOwnerId ?? null,
      });
      if (!preview._count._all) {
        return {
          success: false as const,
          message: "Choose inventory to delete.",
        };
      }
      if (
        (preview._count._all >= 100 || selectionMode === "all") &&
        confirmDelete !== "DELETE"
      ) {
        return {
          success: false as const,
          message: "Type DELETE to confirm deleting this inventory.",
        };
      }
      const result = await bulkDeleteInventoryItems(prisma, {
        actorUserId: actionUser.id,
        itemIds: selectionMode === "all" ? undefined : itemIds,
        where: selectionMode === "all" ? where : undefined,
        allowedOwnerId,
        sourceLocationId: sourceLocationIdRaw || undefined,
        reason: reason || "Inventory deleted.",
        scope: selectionMode === "all" ? "matching" : "selected",
      });
      revalidatePath("/inventory");
      revalidatePath("/locations");
      return { success: true as const, ...result };
    } catch (error: any) {
      console.error("[bulk-inventory-delete] failed", {
        message: error?.message,
        stack: error?.stack,
        selectionMode,
        sourceLocationId: sourceLocationIdRaw || null,
      });
      const rawMessage = String(error?.message || "");
      const exposesPrismaInternals =
        rawMessage.includes("Invalid `prisma.") ||
        rawMessage.includes("Transaction API error") ||
        rawMessage.includes("PrismaClient");
      return {
        success: false as const,
        message:
          exposesPrismaInternals || !rawMessage
            ? "Delete failed. No inventory was removed."
            : rawMessage,
      };
    }
  }

  const orderedItems = orderInventoryItemsByPageGroups(
    items,
    pageGroups,
    displayMode,
  );
  const visibilityFilteredItems = p.visibility
    ? orderedItems.filter((item) => {
        const effectiveVisibility = resolveInventoryVisibility(
          inventoryDefaultByPlayer[item.currentOwnerId] ??
            DefaultCollectionVisibility.PRIVATE,
          item.location?.visibility ?? "INHERIT",
        );
        if (p.visibility === "public") return effectiveVisibility === "PUBLIC";
        if (p.visibility === "private")
          return effectiveVisibility === "PRIVATE";
        if (p.visibility === "inherit")
          return (item.location?.visibility ?? "INHERIT") === "INHERIT";
        return true;
      })
    : orderedItems;
  const exactItems = getInventoryExactPrintings(visibilityFilteredItems);
  const groupedItems = getInventoryGroupedByCard(exactItems);
  const displayItems = displayMode === "grouped" ? groupedItems : exactItems;
  const pageParams = Object.fromEntries(
    Object.entries(p).filter(([key, value]) => value && key !== "page"),
  ) as Record<string, string>;
  const pageHrefBase = new URLSearchParams(pageParams).toString();

  const rows = displayItems
    .map((entry: any) => {
      const i = displayMode === "grouped" ? entry.representative : entry;
      return {
        id: i.id,
        cardId: i.cardId,
        cardName: i.card.name,
        quantity: entry.quantity ?? i.quantity,
        displayMode,
        sourceItemIds: i.sourceItemIds ?? [i.id],
        printingCount: entry.printingCount ?? 1,
        locationCount: entry.locationCount ?? i.locationBreakdown?.length ?? 1,
        locationSummary:
          displayMode === "grouped"
            ? `${entry.quantity} total · ${entry.printingCount} printings · ${entry.locationCount} locations`
            : (i.locationSummary ??
              (i.location?.name
                ? `${i.location.name}: ${i.quantity}`
                : "Unassigned")),
        locationBreakdown: i.locationBreakdown ?? [
          {
            locationId: i.locationId ?? null,
            name: i.location?.name ?? "Unassigned",
            quantity: i.quantity,
          },
        ],
        printings:
          displayMode === "grouped"
            ? entry.printings.map((p: any) => ({
                id: p.id,
                cardName: p.card.name,
                setCode: p.card.setCode.toUpperCase(),
                collectorNumber: p.card.collectorNumber,
                rarity: p.card.rarity,
                foilStatus: p.foilStatus,
                condition: p.condition,
                language: p.language,
                quantity: p.quantity,
                locationBreakdown: p.locationBreakdown,
              }))
            : [],
        locationId: i.locationId ?? "",
        locationName: i.location?.name ?? "Unassigned",
        currentOwnerId: i.currentOwnerId,
        currentOwner: i.currentOwner.displayName,
        currentOwnerColor: i.currentOwner.color || "#64748b",
        setCode: i.card.setCode.toUpperCase(),
        setName: i.card.setName ?? "",
        rarity: i.card.rarity,
        manaCost: i.card.manaCost ?? "",
        manaFaces: getManaFacesForDto(i.card.cardFaces),
        layout: i.card.layout ?? "",
        manaValue: i.card.manaValue ?? undefined,
        typeLine: i.card.typeLine,
        colorIdentity: Array.isArray(i.card.colorIdentity)
          ? i.card.colorIdentity.join(",")
          : JSON.stringify(i.card.colorIdentity ?? ""),
        colors: Array.isArray(i.card.colors)
          ? i.card.colors.join(",")
          : JSON.stringify(i.card.colors ?? ""),
        priceUsd: (i.card.prices as any)?.usd ?? "",
        priceUsdFoil: (i.card.prices as any)?.usd_foil ?? "",
        priceUsdEtched: (i.card.prices as any)?.usd_etched ?? "",
        priceEur: (i.card.prices as any)?.eur ?? "",
        priceEurFoil: (i.card.prices as any)?.eur_foil ?? "",
        priceTix: (i.card.prices as any)?.tix ?? "",
        foil: i.foil,
        foilStatus: i.foilStatus,
        sourceType: i.sourceType,
        language: i.language,
        locationVisibility: i.location?.visibility ?? "INHERIT",
        effectiveVisibility: resolveInventoryVisibility(
          inventoryDefaultByPlayer[i.currentOwnerId] ??
            DefaultCollectionVisibility.PRIVATE,
          i.location?.visibility ?? "INHERIT",
        ),
        oracleText: i.card.oracleText ?? "",
        powerToughness: [i.card.power, i.card.toughness]
          .filter(Boolean)
          .join("/"),
        power: i.card.power ?? "",
        toughness: i.card.toughness ?? "",
        loyalty: i.card.loyalty ?? "",
        defense: i.card.defense ?? "",
        legalities: (i.card.legalities as any) ?? {},
        artist: i.card.artist ?? "",
        collectorNumber: i.card.collectorNumber,
        keywords: Array.isArray(i.card.keywords)
          ? i.card.keywords.join(", ")
          : JSON.stringify(i.card.keywords ?? ""),
        notes: i.notes ?? "",
        condition: i.condition,
        imageUri:
          (i.card.imageUris as any)?.normal ??
          (i.card.imageUris as any)?.small ??
          i.card.imageUri ??
          "",
        imageSmall: (i.card.imageUris as any)?.small ?? "",
        scryfallUri: i.card.scryfallUri ?? "",
        auditHistory: [],
      };
    })
    .filter((row) => {
      if (colorIdentityNeedle) {
        const colorHaystack = row.colorIdentity.toUpperCase();
        if (!colorHaystack.includes(colorIdentityNeedle)) return false;
      }
      if (keywordNeedle) {
        const keywordHaystack = row.keywords.toLowerCase();
        if (!keywordHaystack.includes(keywordNeedle)) return false;
      }
      const usdPrice = row.priceUsd ? Number(row.priceUsd) : undefined;
      if (
        priceMin !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice < priceMin)
      )
        return false;
      if (
        priceMax !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice > priceMax)
      )
        return false;
      return true;
    });

  return (
    <main className="p-8 space-y-4">
      <Nav />
      <h1 className="text-3xl font-bold">Inventory</h1>
      <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-300">
        {adminModeActive
          ? "Showing inventory across all users. Filter to one owner before broad bulk deletes."
          : "Showing your inventory."}
      </p>
      {user ? (
        <section className="border border-zinc-800 rounded p-3 space-y-2">
          <h2 className="font-semibold">Export Inventory</h2>
          <form
            action="/api/inventory/export"
            method="get"
            className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
          >
            <input type="hidden" name="cardName" value={p.cardName || ""} />
            <input type="hidden" name="oracleText" value={p.oracleText || ""} />
            <input type="hidden" name="typeLine" value={p.typeLine || ""} />
            <input type="hidden" name="set" value={p.set || ""} />
            <input type="hidden" name="rarity" value={p.rarity || ""} />
            <input type="hidden" name="foil" value={p.foil || ""} />
            <input
              type="hidden"
              name="colorIdentity"
              value={p.colorIdentity || ""}
            />
            <input
              type="hidden"
              name="manaValueMin"
              value={p.manaValueMin || ""}
            />
            <input
              type="hidden"
              name="manaValueMax"
              value={p.manaValueMax || ""}
            />
            <input type="hidden" name="keyword" value={p.keyword || ""} />
            <input type="hidden" name="priceMin" value={p.priceMin || ""} />
            <input type="hidden" name="priceMax" value={p.priceMax || ""} />
            <input type="hidden" name="locationId" value={p.locationId || ""} />
            <label className="text-sm">
              Format
              <select name="format" className="w-full border p-2 bg-zinc-900">
                <option value="full">MTG Inventory Full CSV</option>
                <option value="moxfield">Moxfield Collection CSV</option>
              </select>
            </label>
            <label className="text-sm">
              Scope
              <select
                name="scope"
                defaultValue="my"
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="filtered">Current filtered view</option>
                <option value="my">My inventory</option>
                {adminModeActive ? (
                  <option value="all">All inventory</option>
                ) : null}
                {adminModeActive ? (
                  <option value="owner">Selected current owner</option>
                ) : null}
              </select>
            </label>
            <label className="text-sm">
              Current owner
              <select
                name="ownerId"
                defaultValue={p.ownerId || userWithPlayer?.playerId || ""}
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="">
                  {adminModeActive ? "all owners" : "my inventory"}
                </option>
                {visiblePlayers.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Moxfield foil
              <select
                name="foilFormat"
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="moxfield">foil or blank</option>
                <option value="boolean">true / false</option>
                <option value="text">foil / nonfoil</option>
              </select>
            </label>
            <div className="col-span-2 md:col-span-5">
              <SubmitButton
                pendingLabel="Generating…"
                className="border px-3 py-2"
              >
                Download CSV
              </SubmitButton>
            </div>
          </form>
          <p className="text-xs text-zinc-400">
            Exports are generated server-side. Non-admin users are always
            limited to their own inventory even if a different scope is
            submitted.
          </p>
        </section>
      ) : (
        <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-400">
          Guest mode is read-only. Log in to export inventory or make changes.
        </p>
      )}
      {adminModeActive ? (
        <section className="border border-zinc-800 rounded p-3 space-y-2">
          <h2 className="font-semibold">Inventory Maintenance</h2>
          <p className="text-sm text-zinc-400">
            Zero-quantity rows are hidden from inventory. Current zero-quantity
            rows: {zeroQuantityCount}.
          </p>
          <form
            action={cleanupZeroQuantityInventory}
            className="flex flex-wrap gap-2 items-end"
          >
            <label className="text-sm flex-1 min-w-64">
              Cleanup reason
              <input
                name="reason"
                defaultValue="Admin cleanup of zero-quantity inventory items."
                className="w-full border p-2 bg-zinc-900"
              />
            </label>
            <SubmitButton
              pendingLabel="Cleaning up…"
              className="border px-3 py-2"
              disabled={zeroQuantityCount === 0}
            >
              Clean up zero-quantity inventory items
            </SubmitButton>
          </form>
        </section>
      ) : null}
      <details open className="border border-zinc-800 rounded p-3">
        <summary className="cursor-pointer font-semibold">
          Advanced Filters
        </summary>
        <form className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <input
            name="cardName"
            defaultValue={p.cardName}
            placeholder="card name contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="oracleText"
            defaultValue={p.oracleText}
            placeholder="oracle text contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="typeLine"
            defaultValue={p.typeLine}
            placeholder="type line contains"
            className="border p-2 bg-zinc-900"
          />
          {adminModeActive ? (
            <select
              name="ownerId"
              defaultValue={p.ownerId}
              className="border p-2 bg-zinc-900"
            >
              <option value="">current owner</option>
              {visiblePlayers.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.displayName}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded border border-zinc-800 p-2 text-sm text-zinc-400">
              Showing your inventory
            </p>
          )}
          <select
            name="displayMode"
            defaultValue={displayMode}
            className="border p-2 bg-zinc-900"
          >
            <option value="exact">Exact printings</option>
            <option value="grouped">Grouped by card name</option>
          </select>
          <select
            name="visibility"
            defaultValue={p.visibility}
            className="border p-2 bg-zinc-900"
          >
            <option value="">all visibility</option>
            <option value="public">effectively public</option>
            <option value="private">effectively private</option>
            <option value="inherit">uses account default</option>
          </select>
          <select
            name="locationId"
            defaultValue={p.locationId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">all locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <input
            name="set"
            defaultValue={p.set}
            placeholder="set"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="rarity"
            defaultValue={p.rarity}
            placeholder="rarity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="colorIdentity"
            defaultValue={p.colorIdentity}
            placeholder="color identity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMin"
            defaultValue={p.manaValueMin}
            placeholder="mana value min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMax"
            defaultValue={p.manaValueMax}
            placeholder="mana value max"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="keyword"
            defaultValue={p.keyword}
            placeholder="keyword contains"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="foil"
            defaultValue={p.foil}
            className="border p-2 bg-zinc-900"
          >
            <option value="">foil/nonfoil</option>
            <option value="true">foil</option>
            <option value="false">nonfoil</option>
          </select>
          <input
            name="priceMin"
            defaultValue={p.priceMin}
            placeholder="price min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="priceMax"
            defaultValue={p.priceMax}
            placeholder="price max"
            className="border p-2 bg-zinc-900"
          />
          <div className="col-span-2 flex gap-2">
            <button className="border px-3">Apply</button>
            <a href="/inventory" className="border px-3 py-2">
              Clear Filters
            </a>
          </div>
        </form>
      </details>
      <InventoryBrowser
        rows={rows}
        players={visiblePlayers.map((p) => ({
          id: p.id,
          name: p.displayName,
          color: p.color,
        }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        cardLabels={cardLabels}
        isAdmin={adminModeActive}
        displayMode={displayMode}
        totalMatchingCount={totalMatchingCount}
        totalMatchingCards={displayItems.reduce(
          (sum: number, entry: any) => sum + (entry.quantity ?? 0),
          0,
        )}
        currentPage={Math.min(currentPage, totalPages)}
        totalPages={totalPages}
        hasPreviousPage={currentPage > 1}
        hasNextPage={currentPage < totalPages}
        pageHrefBase={pageHrefBase}
        infiniteApiPath="/api/inventory/list"
        initialPageSize={initialPageSize}
        initialBrowsingMode={initialBrowsingMode}
        initialSortField={sortField}
        initialSortDirection={sortDirection}
        currentLocationId={p.locationId || ""}
        onBulkMoveLocation={onBulkMoveLocation}
        onBulkDeleteInventory={onBulkDeleteInventory}
        onSaveEdit={onSaveEdit}
        onSearchPrintings={onSearchPrintings}
        onDeleteInventoryItem={deleteInventoryItem}
      />
    </main>
  );
}
