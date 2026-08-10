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
  InventoryLocationKind,
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
import { InventoryAdvancedSearch } from "@/components/InventoryAdvancedSearch";
import { InventoryQuickCardNameSearch } from "@/components/InventoryQuickCardNameSearch";
import {
  cn,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";
import {
  ensureDefaultLocation,
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  groupInventoryPageGroupsByCardName,
  getLocationsForOwner,
  orderInventoryItemsByPageGroups,
  bulkMoveInventoryToLocation,
  bulkDeleteInventoryItems,
  moveInventoryQuantityBetweenLocations,
  splitInventoryStack,
  updateInventoryStack,
} from "@/lib/inventory-locations";
import { getManaFacesForDto } from "@/lib/mtg/mana-display";
import {
  finishForFoilStatus,
  formatSelectedPrice,
  selectPreferredCardPrice,
} from "@/lib/price-history";
import {
  compareInventoryGroups,
  enrichInventoryGroupsForLocationSort,
  isInventoryLocationSort,
} from "@/lib/inventory-sort";
import {
  buildInventoryWhereFromFilters,
  constrainInventoryWhereToPostFilters,
  inventoryCardMatchesPostFilters,
  parseInventoryFilters,
  INVENTORY_FILTER_PARAM_KEYS,
} from "@/lib/inventory-filters";
import {
  buildRelatedCardMetadataByScryfallId,
  enrichAllPartsWithLocalCardMetadata,
} from "@/lib/inventory-related-cards";
import { getActiveLocationTypes } from "@/lib/location-types";
import { addDeckCard } from "@/app/decks/actions";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const userWithPlayer = user;
  const accessScope = user ? await getAccessScope(user) : null;
  const adminModeActive = accessScope?.mode === "admin";
  const editableDecks = user
    ? await prisma.deck.findMany({
        where: adminModeActive ? {} : { ownerUserId: user.id },
        select: {
          id: true,
          name: true,
          format: true,
          ownerUser: { select: { displayName: true } },
        },
        orderBy: [{ name: "asc" }],
      })
    : [];

  const p = await searchParams;
  const filters = parseInventoryFilters(p);
  const where: any = buildInventoryWhereFromFilters(filters, {
    adminModeActive,
    playerId: userWithPlayer?.playerId,
  });

  const displayMode: "exact" | "grouped" =
    p.displayMode === "grouped" ? "grouped" : "exact";
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const initialPageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const initialBrowsingMode: "paginated" | "infinite" =
    p.browse === "infinite" ? "infinite" : "paginated";
  const sortField = p.sort || "cardName";
  const sortDirection: "asc" | "desc" =
    p.sortDir === "desc" || (!p.sortDir && sortField === "releasedAt")
      ? "desc"
      : "asc";
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
  const inventoryGroupFields =
    displayMode === "grouped"
      ? ["cardId"]
      : ["currentOwnerId", "cardId", "foilStatus", "condition", "language"];
  const sortableGroups = isInventoryLocationSort(String(sortField))
    ? await enrichInventoryGroupsForLocationSort(
        prisma,
        allGroups as any[],
        where,
        inventoryGroupFields,
      )
    : (allGroups as any[]);
  const cardSortData = await prisma.card.findMany({
    where: {
      id: {
        in: Array.from(new Set(sortableGroups.map((group) => group.cardId))),
      },
    },
    select: {
      id: true,
      oracleId: true,
      name: true,
      setCode: true,
      rarity: true,
      manaValue: true,
      prices: true,
      collectorNumber: true,
      releasedAt: true,
      typeLine: true,
      manaCost: true,
      colorIdentity: true,
      colors: true,
      cardFaces: true,
      keywords: true,
    },
  });
  const cardSortById = new Map(cardSortData.map((card) => [card.id, card]));
  const groupMatchesClientSafeFilters = (group: any) =>
    inventoryCardMatchesPostFilters(cardSortById.get(group.cardId), filters);
  const filteredPrintingGroups = sortableGroups.filter(
    groupMatchesClientSafeFilters,
  );
  const orderedPrintingGroups = [...filteredPrintingGroups].sort(
    (left, right) =>
      compareInventoryGroups(
        left,
        right,
        cardSortById,
        String(sortField),
        sortDirection,
      ),
  );
  const filteredGroups =
    displayMode === "grouped"
      ? groupInventoryPageGroupsByCardName(orderedPrintingGroups, cardSortById)
      : filteredPrintingGroups;
  const sortedGroups = [...filteredGroups].sort((left, right) =>
    compareInventoryGroups(
      left,
      right,
      cardSortById,
      String(sortField),
      sortDirection,
    ),
  );
  const pageGroups = sortedGroups.slice(querySkip, querySkip + queryPageSize);
  const totalMatchingCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalMatchingCount / queryPageSize));

  const pageGroupWhere =
    displayMode === "grouped"
      ? {
          ...where,
          cardId: {
            in: (pageGroups as any[]).flatMap(
              (group) => group.cardIds ?? [group.cardId],
            ),
          },
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

  const ownerParams = Array.isArray(p.ownerId)
    ? p.ownerId.flatMap((entry) => String(entry).split(",")).filter(Boolean)
    : p.ownerId
      ? String(p.ownerId).split(",").filter(Boolean)
      : [];
  const ownerParam = ownerParams.length === 1 ? ownerParams[0] : "";
  const activeOwnerId =
    ownerParam || (!adminModeActive ? userWithPlayer?.playerId || "" : "");
  const visiblePlayers = adminModeActive
    ? players
    : players.filter((player) => player.id === userWithPlayer?.playerId);
  const locations = activeOwnerId
    ? await getLocationsForOwner(prisma, activeOwnerId)
    : adminModeActive && ownerParams.length
      ? await prisma.inventoryLocation.findMany({
          where: { ownerPlayerId: { in: ownerParams } },
          orderBy: [{ ownerPlayer: { displayName: "asc" } }, { name: "asc" }],
        })
      : await prisma.inventoryLocation.findMany({
          orderBy: [{ ownerPlayer: { displayName: "asc" } }, { name: "asc" }],
        });
  const normalDestinationLocations = locations.filter(
    (location) =>
      location.active &&
      location.kind === InventoryLocationKind.NORMAL &&
      !location.systemManaged,
  );
  const locationTypes = await getActiveLocationTypes(prisma);
  const setOptions: Array<{ setCode: string; setName: string | null }> = [];
  const cardNameOptions: string[] = [];

  const cardLabels = Object.fromEntries(
    items.map((item) => [
      item.cardId,
      `${item.card.name} (${item.card.setCode.toUpperCase()}) #${item.card.collectorNumber}`,
    ]),
  );

  async function onSearchPrintings(fd: FormData) {
    "use server";
    await requireLogin();
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
    const currentOwnerId = before.currentOwnerId;
    if (submittedOwnerId && submittedOwnerId !== currentOwnerId) {
      throw new Error("Stack edits cannot change inventory owner.");
    }

    let cardId = before.cardId;
    const newScryfallId = String(fd.get("newScryfallId") || "");
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

    const foilStatusRaw = String(fd.get("foilStatus") || "NONFOIL");
    if (!["NONFOIL", "FOIL", "ETCHED"].includes(foilStatusRaw)) {
      throw new Error("Invalid foil status.");
    }
    const foilStatus = foilStatusRaw as FoilStatus;
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

    await updateInventoryStack(prisma, {
      inventoryItemId,
      actorUserId: actionUser.id,
      allowedOwnerId: actionIsAdmin
        ? ownerParam || before.currentOwnerId
        : actionUser.playerId || undefined,
      target: {
        cardId,
        quantity,
        foilStatus,
        condition: String(fd.get("condition") || before.condition),
        language: String(fd.get("language") || before.language || "EN"),
        locationId: targetLocationId,
        notes: String(fd.get("notes") || "") || null,
        sourceType: actionIsAdmin
          ? (String(
              fd.get("sourceType") || "CORRECTION",
            ) as InventorySourceType)
          : before.sourceType,
      },
      reason:
        String(fd.get("reason") || "") ||
        (newScryfallId ? "Printing correction." : "Inventory stack edit."),
    });

    revalidatePath("/inventory");
  }

  async function onSplitInventoryStack(fd: FormData) {
    "use server";
    const actionUser = await requireLogin();
    const actionScope = await getAccessScope(actionUser);
    const actionIsAdmin = actionScope?.mode === "admin";
    const inventoryItemId = String(fd.get("inventoryItemId") || "");
    const quantity = Number(fd.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Split quantity must be a positive integer.");
    }

    const before = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!before) throw new Error("Inventory item not found.");
    if (!actionIsAdmin) {
      if (!actionUser.playerId) {
        throw new Error("Your account is not linked to an inventory owner.");
      }
      if (before.currentOwnerId !== actionUser.playerId) {
        throw new Error("You can only split inventory you own.");
      }
    }

    let cardId = before.cardId;
    const newScryfallId = String(fd.get("newScryfallId") || "");
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

    const foilStatusRaw = String(fd.get("foilStatus") || before.foilStatus);
    if (!["NONFOIL", "FOIL", "ETCHED"].includes(foilStatusRaw)) {
      throw new Error("Invalid foil status.");
    }
    const foilStatus = foilStatusRaw as FoilStatus;
    const locationIdRaw = String(fd.get("locationId") || "");
    const defaultLocation = await ensureDefaultLocation(
      prisma,
      before.currentOwnerId,
    );
    const targetLocationId = locationIdRaw || defaultLocation.id;
    await splitInventoryStack(prisma, {
      inventoryItemId,
      actorUserId: actionUser.id,
      allowedOwnerId: actionIsAdmin
        ? ownerParam || before.currentOwnerId
        : actionUser.playerId || undefined,
      target: {
        cardId,
        quantity,
        foilStatus,
        condition: String(fd.get("condition") || before.condition),
        language: String(fd.get("language") || before.language || "EN"),
        locationId: targetLocationId,
        notes: String(fd.get("notes") || "") || null,
        sourceType: actionIsAdmin
          ? (String(
              fd.get("sourceType") || before.sourceType,
            ) as InventorySourceType)
          : before.sourceType,
      },
      reason:
        String(fd.get("reason") || "") ||
        (newScryfallId
          ? "Split stack with printing correction."
          : "Inventory stack split."),
    });
    revalidatePath("/inventory");
    revalidatePath("/locations");
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
      const matchingWhere =
        selectionMode === "all"
          ? await constrainInventoryWhereToPostFilters(
              prisma,
              previewWhere,
              filters,
            )
          : previewWhere;
      const preview = await prisma.inventoryItem.aggregate({
        where: matchingWhere,
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
        where: selectionMode === "all" ? matchingWhere : undefined,
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
        ? ownerParam || undefined
        : actionUser.playerId || undefined;
      const previewWhere: any =
        selectionMode === "all" ? { ...where } : { id: { in: itemIds } };
      previewWhere.quantity = { gt: 0 };
      if (sourceLocationIdRaw) previewWhere.locationId = sourceLocationIdRaw;
      if (allowedOwnerId) previewWhere.currentOwnerId = allowedOwnerId;
      const matchingWhere =
        selectionMode === "all"
          ? await constrainInventoryWhereToPostFilters(
              prisma,
              previewWhere,
              filters,
            )
          : previewWhere;
      const preview = await prisma.inventoryItem.aggregate({
        where: matchingWhere,
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
        where: selectionMode === "all" ? matchingWhere : undefined,
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

  async function onMoveInventoryCopies(fd: FormData) {
    "use server";
    const actionUser = await requireLogin();
    const actionScope = await getAccessScope(actionUser);
    const actionIsAdmin = actionScope?.mode === "admin";
    const inventoryItemId = String(fd.get("inventoryItemId") || "");
    const destinationLocationId = String(fd.get("destinationLocationId") || "");
    const quantity = Number(fd.get("quantity"));
    const reason = String(fd.get("reason") || "").trim();

    try {
      if (!actionIsAdmin && !actionUser.playerId) {
        return {
          success: false as const,
          message: "Your account is not linked to an inventory owner.",
        };
      }
      const result = await moveInventoryQuantityBetweenLocations(prisma, {
        inventoryItemId,
        destinationLocationId,
        quantity,
        actorUserId: actionUser.id,
        allowedOwnerId: actionIsAdmin
          ? ownerParam || undefined
          : actionUser.playerId || undefined,
        reason: reason || undefined,
      });
      revalidatePath("/inventory");
      revalidatePath("/locations");
      return {
        success: true as const,
        cardName: result.cardName,
        quantityMoved: result.quantityMoved,
        sourceLocationName: result.sourceLocationName,
        destinationLocationName: result.destinationLocationName,
      };
    } catch (error: any) {
      console.error("[inventory-stack-move] failed", {
        message: error?.message,
        stack: error?.stack,
        inventoryItemId,
        destinationLocationId,
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
            ? "Move failed. No inventory was changed."
            : rawMessage,
      };
    }
  }

  const orderedItems = orderInventoryItemsByPageGroups(
    items,
    pageGroups,
    displayMode,
  );
  const visibilityFilteredItems = orderedItems;
  const exactItems = getInventoryExactPrintings(visibilityFilteredItems);
  const groupedItems = getInventoryGroupedByCard(exactItems);
  const displayItems = displayMode === "grouped" ? groupedItems : exactItems;
  const relatedCardsByScryfallId =
    await buildRelatedCardMetadataByScryfallId(displayItems);
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
            inventoryItemId: i.id,
            locationId: i.locationId ?? null,
            name: i.location?.name ?? "Unassigned",
            quantity: i.quantity,
            foilStatus: i.foilStatus,
            condition: i.condition,
            language: i.language,
            sourceType: i.sourceType,
            locationKind: i.location?.kind ?? null,
            locationActive: i.location?.active ?? null,
            locationSystemManaged: i.location?.systemManaged ?? null,
          },
        ],
        printings:
          displayMode === "grouped"
            ? entry.printings.map((p: any) => ({
                id: p.id,
                cardId: p.cardId,
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
        cardFaces: Array.isArray(i.card.cardFaces) ? i.card.cardFaces : [],
        allParts: enrichAllPartsWithLocalCardMetadata(
          i.card.allParts,
          relatedCardsByScryfallId,
        ),
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
        preferredPriceLabel: formatSelectedPrice(
          selectPreferredCardPrice(undefined, i.card.prices, {
            finish: finishForFoilStatus(i.foilStatus),
            preferredProvider: userWithPlayer?.preferredPriceProvider,
          }),
        ),
        priceChange7Day: "",
        priceChange30Day: "",
        priceChange90Day: "",
        priceHistory: [],
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
        releasedAt: i.card.releasedAt?.toISOString().slice(0, 10) ?? "",
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
    .filter((row) =>
      inventoryCardMatchesPostFilters(
        {
          colorIdentity: row.colorIdentity,
          colors: row.colors,
          cardFaces: row.cardFaces,
          keywords: row.keywords,
          prices: {
            usd: row.priceUsd,
            usd_foil: row.priceUsdFoil,
            usd_etched: row.priceUsdEtched,
          },
        },
        filters,
      ),
    );

  const selected = (key: string) => {
    const value = (p as Record<string, any>)[key];
    return Array.isArray(value)
      ? value.flatMap((entry) => String(entry).split(","))
      : value
        ? String(value).split(",")
        : [];
  };
  const clearFilterParams = new URLSearchParams();
  clearFilterParams.set("displayMode", displayMode);
  if (p.pageSize) clearFilterParams.set("pageSize", String(p.pageSize));
  if (p.browse) clearFilterParams.set("browse", String(p.browse));
  if (p.sort) clearFilterParams.set("sort", String(p.sort));
  if (p.sortDir) clearFilterParams.set("sortDir", String(p.sortDir));
  const clearFiltersHref = `/inventory?${clearFilterParams.toString()}`;
  const importExportParams = new URLSearchParams();
  INVENTORY_FILTER_PARAM_KEYS.forEach((key) => {
    const value = (p as Record<string, any>)[key];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    values.forEach((entry) => importExportParams.append(key, String(entry)));
  });
  importExportParams.set("exportTools", "1");
  const importExportHref = `/imports?${importExportParams.toString()}`;

  return (
    <main className="p-8 space-y-4">
      <Nav />
      <h1 className="text-3xl font-bold">Inventory</h1>
      <a className="text-sm text-sky-300 underline" href="/pricing">
        View value trends
      </a>
      <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-300">
        {adminModeActive
          ? "Showing inventory across all users. Filter to one owner before broad bulk deletes."
          : "Showing your inventory."}
      </p>
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
                className={cn(filterSelectClass, "mt-1 w-full")}
              />
            </label>
            <SubmitButton
              pendingLabel="Cleaning up…"
              className={filterPrimaryButtonClass}
              disabled={zeroQuantityCount === 0}
            >
              Clean up zero-quantity inventory items
            </SubmitButton>
          </form>
        </section>
      ) : null}
      <InventoryQuickCardNameSearch actionPath="/inventory" params={p} />
      <InventoryAdvancedSearch
        actionPath="/inventory"
        params={p}
        displayMode={displayMode}
        isAdmin={adminModeActive}
        players={visiblePlayers.map((player) => ({
          value: player.id,
          label: player.displayName,
        }))}
        locations={normalDestinationLocations.map((location) => ({
          value: location.id,
          label: location.name,
          kind: location.kind,
        }))}
        locationTypes={[
          { value: "Deck", label: "Deck" },
          ...locationTypes.map((type) => ({
            value: type.name,
            label: type.name,
          })),
        ]}
        setOptions={setOptions.map((set) => ({
          value: set.setCode,
          label: `${set.setCode.toUpperCase()} — ${set.setName || set.setCode.toUpperCase()}`,
        }))}
        cardNameOptions={cardNameOptions}
        clearHref={clearFiltersHref}
      />
      <InventoryBrowser
        rows={rows}
        players={visiblePlayers.map((p) => ({
          id: p.id,
          name: p.displayName,
          color: p.color,
        }))}
        locations={normalDestinationLocations.map((l) => ({
          id: l.id,
          name: l.name,
          ownerPlayerId: l.ownerPlayerId,
          active: l.active,
          kind: l.kind,
        }))}
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
        initialSortField={String(sortField)}
        initialSortDirection={sortDirection}
        currentLocationId={selected("locationId")[0] || ""}
        onBulkMoveLocation={onBulkMoveLocation}
        onBulkDeleteInventory={onBulkDeleteInventory}
        onMoveInventoryCopies={onMoveInventoryCopies}
        onSplitInventoryStack={onSplitInventoryStack}
        onSaveEdit={onSaveEdit}
        onSearchPrintings={onSearchPrintings}
        onDeleteInventoryItem={deleteInventoryItem}
        deckTargets={editableDecks.map((deck) => ({
          id: deck.id,
          name: deck.name,
          format: deck.format,
          ownerName: adminModeActive ? deck.ownerUser.displayName : undefined,
        }))}
        onAddToDeck={addDeckCard}
        importExportHref={user ? importExportHref : undefined}
      />
    </main>
  );
}
