export const dynamic = "force-dynamic";
import {
  getCurrentUser,
  isAdminUser,
  requireAdmin,
  requireLogin,
} from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { FoilStatus, InventorySourceType } from "@prisma/client";
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
  bulkMoveInventoryToLocation,
} from "@/lib/inventory-locations";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  const userWithPlayer = user;
  const isAdmin = isAdminUser(user, user?.player);

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
  if (!isAdmin) {
    where.currentOwnerId = userWithPlayer?.playerId || "__no_owner__";
  } else if (p.ownerId) {
    where.currentOwnerId = p.ownerId;
  }
  if (p.originalOpenerId) where.originalOpenerId = p.originalOpenerId;
  if (p.roundId) where.roundId = p.roundId;
  if (p.locationId) where.locationId = p.locationId;
  if (p.hasLocation === "unassigned")
    where.location = { normalizedName: "unassigned" };
  if (p.set)
    where.card = { ...(where.card || {}), setCode: p.set.toLowerCase() };
  if (p.rarity) where.card = { ...(where.card || {}), rarity: p.rarity };
  if (p.foil === "true") where.foil = true;
  if (p.foil === "false") where.foil = false;
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
  const [items, players, rounds, zeroQuantityCount] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        card: true,
        currentOwner: true,
        originalOpener: true,
        round: true,
        location: true,
        auditLogs: {
          orderBy: { createdAt: "desc" },
          include: { changedByUser: { include: { player: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.player.findMany({ orderBy: { displayName: "asc" } }),
    prisma.round.findMany({ orderBy: { startDate: "desc" } }),
    isAdmin
      ? prisma.inventoryItem.count({ where: { quantity: { lte: 0 } } })
      : Promise.resolve(0),
  ]);

  const activeOwnerId =
    p.ownerId || (!isAdmin ? userWithPlayer?.playerId || "" : "");
  const locations = activeOwnerId
    ? await getLocationsForOwner(prisma, activeOwnerId)
    : await prisma.inventoryLocation.findMany({
        orderBy: [{ ownerPlayer: { displayName: "asc" } }, { name: "asc" }],
      });

  const auditCardIds = Array.from(
    new Set(
      items.flatMap((item) =>
        item.auditLogs.flatMap((audit) => {
          const beforeJson = audit.beforeJson as Record<string, unknown>;
          const afterJson = audit.afterJson as Record<string, unknown>;
          return [beforeJson?.cardId, afterJson?.cardId].filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          );
        }),
      ),
    ),
  );

  const auditCards = auditCardIds.length
    ? await prisma.card.findMany({
        where: { id: { in: auditCardIds } },
        select: { id: true, name: true, setCode: true, collectorNumber: true },
      })
    : [];

  const cardLabels = Object.fromEntries([
    ...items.map((item) => [
      item.cardId,
      `${item.card.name} (${item.card.setCode.toUpperCase()}) #${item.card.collectorNumber}`,
    ]),
    ...auditCards.map((card) => [
      card.id,
      `${card.name} (${card.setCode.toUpperCase()}) #${card.collectorNumber}`,
    ]),
  ]);

  async function onSearchPrintings(fd: FormData) {
    "use server";
    await requireAdmin();
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
    const actionUser = await requireAdmin();
    const inventoryItemId = String(fd.get("inventoryItemId") || "");
    const quantity = Number(fd.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new Error("Quantity must be a positive integer");
    const currentOwnerId = String(fd.get("currentOwnerId") || "");
    if (!currentOwnerId) throw new Error("Current owner is required");

    const before = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!before) throw new Error("Inventory item not found");

    let cardId = String(fd.get("existingCardId") || before.cardId);
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

    const roundIdRaw = String(fd.get("roundId") || "");
    const originalOpenerRaw = String(fd.get("originalOpenerId") || "");
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
        originalOpenerId: originalOpenerRaw || before.originalOpenerId,
        roundId: roundIdRaw || null,
        quantity,
        foilStatus,
        foil: foilStatus !== FoilStatus.NONFOIL,
        condition: String(fd.get("condition") || before.condition),
        locationId: targetLocationId,
        notes: String(fd.get("notes") || "") || null,
        sourceType: String(
          fd.get("sourceType") || "CORRECTION",
        ) as InventorySourceType,
        cardId,
      },
    });

    await prisma.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: actionUser.id,
        changeType: newScryfallId ? "printing_correction" : "manual_edit",
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
    const actionIsAdmin = isAdminUser(actionUser, actionUser.player);
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
        _sum: { quantity: true },
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

  const exactItems = getInventoryExactPrintings(items);
  const groupedItems = getInventoryGroupedByCard(exactItems);
  const displayItems = displayMode === "grouped" ? groupedItems : exactItems;

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
        originalOpenerId: i.originalOpenerId,
        originalOpener: i.originalOpener.displayName,
        roundId: i.roundId ?? "",
        setCode: i.card.setCode.toUpperCase(),
        setName: i.card.setName ?? "",
        rarity: i.card.rarity,
        manaCost: i.card.manaCost ?? "",
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
        roundOpened: i.round?.name ?? "No acquisition group",
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
        auditHistory: (i.auditLogs ?? []).map((a: any) => ({
          id: a.id,
          changeType: a.changeType,
          reason: a.reason ?? "",
          createdAt: a.createdAt.toISOString(),
          changedBy:
            a.changedByUser?.player?.displayName ??
            a.changedByUser?.username ??
            "",
          beforeJson: a.beforeJson as Record<string, unknown>,
          afterJson: a.afterJson as Record<string, unknown>,
        })),
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
            <input
              type="hidden"
              name="originalOpenerId"
              value={p.originalOpenerId || ""}
            />
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
                {isAdmin ? <option value="all">All inventory</option> : null}
                {isAdmin ? (
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
                  {isAdmin ? "all owners" : "my inventory"}
                </option>
                {players.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Acquisition group
              <select
                name="roundId"
                defaultValue={p.roundId || ""}
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="">all groups</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
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
      {isAdmin ? (
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
          <select
            name="ownerId"
            defaultValue={p.ownerId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">current owner</option>
            {players.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.displayName}
              </option>
            ))}
          </select>
          <select
            name="originalOpenerId"
            defaultValue={p.originalOpenerId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">original opener</option>
            {players.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.displayName}
              </option>
            ))}
          </select>
          <select
            name="displayMode"
            defaultValue={displayMode}
            className="border p-2 bg-zinc-900"
          >
            <option value="exact">Exact printings</option>
            <option value="grouped">Grouped by card name</option>
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
          <select
            name="roundId"
            defaultValue={p.roundId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">acquisition group</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
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
        players={players.map((p) => ({
          id: p.id,
          name: p.displayName,
          color: p.color,
        }))}
        rounds={rounds.map((r) => ({ id: r.id, name: r.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        cardLabels={cardLabels}
        isAdmin={isAdmin}
        displayMode={displayMode}
        totalMatchingCount={
          displayMode === "grouped" ? groupedItems.length : exactItems.length
        }
        totalMatchingCards={displayItems.reduce(
          (sum: number, entry: any) => sum + (entry.quantity ?? 0),
          0,
        )}
        initialPageSize={initialPageSize}
        initialBrowsingMode={initialBrowsingMode}
        currentLocationId={p.locationId || ""}
        onBulkMoveLocation={onBulkMoveLocation}
        onSaveEdit={onSaveEdit}
        onSearchPrintings={onSearchPrintings}
        onDeleteInventoryItem={deleteInventoryItem}
      />
    </main>
  );
}
