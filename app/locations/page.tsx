export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import {
  LocationContentsDeleteForm,
  type LocationContentsDeleteResult,
} from "@/components/LocationContentsDeleteForm";
import { LocationMoveForm } from "@/components/LocationMoveForm";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, getCurrentUser, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  effectiveVisibilityLabel,
  resolveInventoryVisibility,
  visibilityLabel,
} from "@/lib/visibility";
import {
  DefaultCollectionVisibility,
  InventoryLocationKind,
  Visibility,
} from "@prisma/client";
import {
  cn,
  filterDangerButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPanelClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";
import {
  bulkMoveInventoryToLocation,
  bulkDeleteInventoryItems,
  createLocation,
  deleteUnusedLocation,
  ensureDefaultLocation,
  updateLocation,
} from "@/lib/inventory-locations";

function parseVisibility(value: FormDataEntryValue | null) {
  return value === Visibility.PUBLIC || value === Visibility.PRIVATE
    ? value
    : Visibility.INHERIT;
}

function visibilityTone(value: "PRIVATE" | "PUBLIC") {
  return value === "PUBLIC"
    ? "border-emerald-700 bg-emerald-950/30 text-emerald-100"
    : "border-zinc-700 bg-zinc-900 text-zinc-200";
}

async function getActionContext() {
  const user = await requireLogin();
  const userWithPlayer = await prisma.user.findUnique({
    where: { id: user.id },
    include: { player: true },
  });
  const scope = await getAccessScope(userWithPlayer ?? user);
  const admin = scope?.mode === "admin";
  if (!userWithPlayer?.playerId && !admin)
    throw new Error("Your account is not linked to an inventory owner.");
  return { user, playerId: userWithPlayer?.playerId ?? null, admin };
}

export default async function LocationsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="p-8 space-y-4">
        <Nav />
        <p className="rounded border border-zinc-800 p-3">
          Log in to manage locations.
        </p>
      </main>
    );
  }
  const accessScope = await getAccessScope(user);
  const adminModeActive = accessScope?.mode === "admin";
  const owners = adminModeActive
    ? await prisma.player.findMany({ orderBy: { displayName: "asc" } })
    : user.player
      ? [user.player]
      : [];
  for (const owner of owners) await ensureDefaultLocation(prisma, owner.id);
  const selectedOwnerId = user.playerId || owners[0]?.id || "";
  const locations = await prisma.inventoryLocation.findMany({
    where: adminModeActive ? {} : { ownerPlayerId: selectedOwnerId },
    include: {
      ownerPlayer: true,
      deck: true,
      _count: { select: { inventoryItems: true } },
    },
    orderBy: [
      { ownerPlayer: { displayName: "asc" } },
      { active: "desc" },
      { name: "asc" },
    ],
  });
  const ownerUsers = locations.length
    ? await prisma.user.findMany({
        where: {
          playerId: {
            in: Array.from(
              new Set(locations.map((location) => location.ownerPlayerId)),
            ),
          },
        },
        select: { playerId: true, inventoryDefaultVisibility: true },
      })
    : [];
  const inventoryDefaultByPlayer = Object.fromEntries(
    ownerUsers
      .filter((ownerUser) => ownerUser.playerId)
      .map((ownerUser) => [
        ownerUser.playerId!,
        ownerUser.inventoryDefaultVisibility,
      ]),
  );
  const effectiveLocationVisibility = (location: {
    ownerPlayerId: string;
    visibility: Visibility;
  }) =>
    resolveInventoryVisibility(
      inventoryDefaultByPlayer[location.ownerPlayerId] ??
        DefaultCollectionVisibility.PRIVATE,
      location.visibility,
    );

  const quantities = locations.length
    ? await prisma.inventoryItem.groupBy({
        by: ["locationId"],
        where: {
          locationId: { in: locations.map((l) => l.id) },
          quantity: { gt: 0 },
        },
        _sum: { quantity: true },
        _count: true,
      })
    : [];
  const quantityByLocation = Object.fromEntries(
    quantities.map((q) => [
      q.locationId ?? "",
      { quantity: q._sum.quantity ?? 0, entries: q._count },
    ]),
  );
  const normalLocations = locations.filter(
    (location) => location.kind === InventoryLocationKind.NORMAL,
  );
  const deckLocations = locations.filter(
    (location) => location.kind === InventoryLocationKind.DECK,
  );
  type NormalLocation = (typeof normalLocations)[number];
  const countsForLocation = (locationId: string) =>
    quantityByLocation[locationId] ?? { quantity: 0, entries: 0 };
  const normalLocationGroups = Array.from(
    normalLocations
      .reduce(
        (ownerMap, location) => {
          const counts = countsForLocation(location.id);
          let ownerGroup = ownerMap.get(location.ownerPlayerId);
          if (!ownerGroup) {
            ownerGroup = {
              id: location.ownerPlayerId,
              name: location.ownerPlayer.displayName,
              quantity: 0,
              entries: 0,
              types: new Map<
                string,
                {
                  label: string;
                  quantity: number;
                  entries: number;
                  locations: NormalLocation[];
                }
              >(),
            };
            ownerMap.set(location.ownerPlayerId, ownerGroup);
          }
          const typeLabel = location.type?.trim() || "Unsorted";
          let typeGroup = ownerGroup.types.get(typeLabel);
          if (!typeGroup) {
            typeGroup = {
              label: typeLabel,
              quantity: 0,
              entries: 0,
              locations: [],
            };
            ownerGroup.types.set(typeLabel, typeGroup);
          }
          ownerGroup.quantity += counts.quantity;
          ownerGroup.entries += counts.entries;
          typeGroup.quantity += counts.quantity;
          typeGroup.entries += counts.entries;
          typeGroup.locations.push(location);
          return ownerMap;
        },
        new Map<
          string,
          {
            id: string;
            name: string;
            quantity: number;
            entries: number;
            types: Map<
              string,
              {
                label: string;
                quantity: number;
                entries: number;
                locations: NormalLocation[];
              }
            >;
          }
        >(),
      )
      .values(),
  ).map((ownerGroup) => ({
    ...ownerGroup,
    types: Array.from(ownerGroup.types.values()),
  }));

  async function createLocationAction(fd: FormData) {
    "use server";
    const ctx = await getActionContext();
    const ownerPlayerId = String(fd.get("ownerPlayerId") || ctx.playerId || "");
    if (!ownerPlayerId) throw new Error("Owner is required.");
    if (!ctx.admin && ownerPlayerId !== ctx.playerId)
      throw new Error("Not authorized for this owner.");
    const location = await createLocation(prisma, {
      ownerPlayerId,
      name: String(fd.get("name") || ""),
      description: String(fd.get("description") || "") || null,
      type: String(fd.get("type") || "") || null,
      visibility: parseVisibility(fd.get("visibility")),
    });
    await prisma.inventoryAuditLog.create({
      data: {
        changedByUserId: ctx.user.id,
        changeType: "location_created",
        beforeJson: {},
        afterJson: location as any,
        reason: "Location created.",
      },
    });
    revalidatePath("/locations");
    revalidatePath("/inventory");
  }

  async function updateLocationAction(fd: FormData) {
    "use server";
    const ctx = await getActionContext();
    const id = String(fd.get("locationId") || "");
    const before = await prisma.inventoryLocation.findUnique({ where: { id } });
    if (!before) throw new Error("Location not found.");
    if (!ctx.admin && before.ownerPlayerId !== ctx.playerId)
      throw new Error("Not authorized for this location.");
    const updated = await updateLocation(prisma, {
      id,
      ownerPlayerId: before.ownerPlayerId,
      name: String(fd.get("name") || ""),
      description: String(fd.get("description") || "") || null,
      type: String(fd.get("type") || "") || null,
      active: fd.get("active") === "on",
      visibility: parseVisibility(fd.get("visibility")),
    });
    await prisma.inventoryAuditLog.create({
      data: {
        changedByUserId: ctx.user.id,
        changeType: updated.active
          ? "location_updated"
          : "location_deactivated",
        beforeJson: before as any,
        afterJson: updated as any,
        reason: "Location updated.",
      },
    });
    revalidatePath("/locations");
    revalidatePath("/inventory");
  }

  async function moveLocationAction(fd: FormData) {
    "use server";
    const ctx = await getActionContext();
    const sourceLocationId = String(fd.get("sourceLocationId") || "");
    const destinationLocationId = String(fd.get("destinationLocationId") || "");
    if (fd.get("confirmMove") !== "on") {
      throw new Error("Confirm the full-location move before applying it.");
    }
    if (!sourceLocationId || !destinationLocationId) {
      throw new Error("Choose both source and destination locations.");
    }
    if (sourceLocationId === destinationLocationId) {
      throw new Error("Source and destination locations must be different.");
    }
    await bulkMoveInventoryToLocation(prisma, {
      actorUserId: ctx.user.id,
      destinationLocationId,
      sourceLocationId,
      where: { locationId: sourceLocationId },
      allowedOwnerId: ctx.admin ? undefined : ctx.playerId || undefined,
      reason: "Move all inventory from one location to another.",
    });
    revalidatePath("/locations");
    revalidatePath("/inventory");
  }

  async function deleteLocationContentsAction(
    fd: FormData,
  ): Promise<LocationContentsDeleteResult> {
    "use server";
    const locationId = String(fd.get("locationId") || "");
    const confirmDelete = String(fd.get("confirmDeleteContents") || "").trim();
    const startedAt = Date.now();

    try {
      if (!locationId) {
        return {
          success: false,
          message: "Choose a location before deleting contents.",
        };
      }

      const ctx = await getActionContext();
      console.info("[location-contents-delete] request", {
        actingUserId: ctx.user.id,
        locationId,
        admin: ctx.admin,
        ownerScope: ctx.admin ? "admin" : ctx.playerId,
        confirmationProvided: Boolean(confirmDelete),
      });

      const location = await prisma.inventoryLocation.findUnique({
        where: { id: locationId },
        select: { id: true, ownerPlayerId: true, name: true },
      });
      console.info("[location-contents-delete] location lookup", {
        actingUserId: ctx.user.id,
        locationId,
        found: Boolean(location),
        ownerPlayerId: location?.ownerPlayerId ?? null,
        locationName: location?.name ?? null,
      });

      if (!location) {
        return { success: false, message: "Location not found." };
      }
      if (!ctx.admin && location.ownerPlayerId !== ctx.playerId) {
        return {
          success: false,
          message:
            "You do not have permission to delete this location's contents.",
        };
      }
      if (confirmDelete !== "DELETE" && confirmDelete !== location.name) {
        return {
          success: false,
          message:
            "Type DELETE or the location name to confirm deleting contents.",
        };
      }

      const preview = await prisma.inventoryItem.aggregate({
        where: {
          locationId,
          quantity: { gt: 0 },
          currentOwnerId: ctx.admin
            ? location.ownerPlayerId
            : ctx.playerId || undefined,
        },
        _count: { _all: true },
        _sum: { quantity: true },
      });
      console.info("[location-contents-delete] preview", {
        actingUserId: ctx.user.id,
        locationId,
        locationName: location.name,
        ownerPlayerId: location.ownerPlayerId,
        matchedInventoryRows: preview._count._all,
        matchedPhysicalCards: preview._sum.quantity ?? 0,
      });

      if (!preview._count._all || !(preview._sum.quantity ?? 0)) {
        return {
          success: false,
          message: "This location has no inventory to delete.",
        };
      }

      console.info("[location-contents-delete] mutation starting", {
        actingUserId: ctx.user.id,
        locationId,
        matchedInventoryRows: preview._count._all,
        matchedPhysicalCards: preview._sum.quantity ?? 0,
      });
      const result = await bulkDeleteInventoryItems(prisma, {
        actorUserId: ctx.user.id,
        where: { locationId },
        sourceLocationId: locationId,
        allowedOwnerId: ctx.admin
          ? location.ownerPlayerId
          : ctx.playerId || undefined,
        reason: `Deleted all inventory contents in ${location.name}.`,
        scope: "location",
      });
      console.info("[location-contents-delete] mutation committed", {
        actingUserId: ctx.user.id,
        locationId,
        locationName: location.name,
        deletedEntries: result.deletedEntries,
        deletedCards: result.deletedCards,
        auditRowsExpected: result.deletedEntries,
        durationMs: Date.now() - startedAt,
      });

      revalidatePath("/locations");
      revalidatePath("/inventory");
      console.info("[location-contents-delete] revalidated", {
        actingUserId: ctx.user.id,
        locationId,
        paths: ["/locations", "/inventory"],
      });

      return {
        success: true,
        message: `Deleted ${result.deletedCards} cards across ${result.deletedEntries} inventory entries from ${location.name}.`,
        deletedEntries: result.deletedEntries,
        deletedCards: result.deletedCards,
        locationName: location.name,
      };
    } catch (error: any) {
      console.error("[location-contents-delete] unexpected failure", {
        locationId,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        durationMs: Date.now() - startedAt,
      });
      const rawMessage = String(error?.message || "");
      const safeMessages = [
        "This location has no inventory to delete.",
        "Some inventory changed before deletion. Refresh and try again.",
        "Some selected inventory is reserved in active trades and cannot be deleted.",
        "You do not have permission to delete this inventory.",
      ];
      const exposesPrismaInternals =
        rawMessage.includes("Invalid `prisma.") ||
        rawMessage.includes("Transaction API error") ||
        rawMessage.includes("PrismaClient") ||
        rawMessage.includes("Foreign key constraint") ||
        rawMessage.includes("Unique constraint");
      return {
        success: false,
        message:
          !exposesPrismaInternals && safeMessages.includes(rawMessage)
            ? rawMessage
            : "Delete contents failed unexpectedly. No inventory was removed. Check server logs for details.",
      };
    }
  }

  async function deleteLocationAction(fd: FormData) {
    "use server";
    const ctx = await getActionContext();
    const id = String(fd.get("locationId") || "");
    if (fd.get("confirmDelete") !== "on") {
      throw new Error("Confirm deletion before removing a location.");
    }
    const before = await prisma.inventoryLocation.findUnique({ where: { id } });
    if (!before) throw new Error("Location not found.");
    if (!ctx.admin && before.ownerPlayerId !== ctx.playerId)
      throw new Error("Not authorized for this location.");
    await deleteUnusedLocation(prisma, id);
    await prisma.inventoryAuditLog.create({
      data: {
        changedByUserId: ctx.user.id,
        changeType: "location_deleted",
        beforeJson: before as any,
        afterJson: { deleted: true, id },
        reason: "Location deleted.",
      },
    });
    revalidatePath("/locations");
    revalidatePath("/inventory");
  }

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <div>
        <h1 className="text-3xl font-bold">Locations</h1>
        <p className="text-zinc-400">
          Manage storage locations such as boxes, shelves, binders, and
          deckboxes.
        </p>
        <p className="mt-2 rounded border border-zinc-800 p-3 text-sm text-zinc-300">
          {adminModeActive
            ? "Admin mode: showing locations across users."
            : "Showing your locations."}
        </p>
      </div>

      <section className={cn(filterPanelClass, "space-y-3")}>
        <h2 className="text-xl font-semibold">Create location</h2>
        <form
          action={createLocationAction}
          className="grid gap-3 md:grid-cols-7"
        >
          {adminModeActive ? (
            <select
              name="ownerPlayerId"
              defaultValue={selectedOwnerId}
              className={filterSelectClass}
            >
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="ownerPlayerId" value={selectedOwnerId} />
          )}
          <input
            name="name"
            required
            placeholder="Box-0001"
            className={filterInputClass}
          />
          <input
            name="type"
            placeholder="Box, Binder, Shelf"
            className={filterInputClass}
          />
          <input
            name="description"
            placeholder="description optional"
            className={filterInputClass}
          />
          <select
            name="visibility"
            defaultValue={Visibility.INHERIT}
            className={filterSelectClass}
          >
            <option value={Visibility.INHERIT}>Use account default</option>
            <option value={Visibility.PRIVATE}>Private</option>
            <option value={Visibility.PUBLIC}>Public</option>
          </select>
          <SubmitButton
            pendingLabel="Creating location…"
            className={filterPrimaryButtonClass}
          >
            Create Location
          </SubmitButton>
        </form>
      </section>

      <section className={cn(filterPanelClass, "space-y-3")}>
        <h2 className="text-xl font-semibold">Move an entire location</h2>
        <p className="text-sm text-zinc-400">
          Move every inventory entry from one location to another. Matching
          destination rows are merged and the operation is transactional.
        </p>
        <LocationMoveForm
          moveAction={moveLocationAction}
          locations={normalLocations.map((location) => {
            const counts = quantityByLocation[location.id] ?? {
              quantity: 0,
              entries: 0,
            };
            return {
              id: location.id,
              name: location.name,
              entries: counts.entries,
              quantity: counts.quantity,
              effectiveVisibility: effectiveLocationVisibility(location),
            };
          })}
        />
      </section>

      {deckLocations.length ? (
        <section className={cn(filterPanelClass, "space-y-3")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Deck locations</h2>
              <p className="text-sm text-zinc-400">
                System-managed locations created by deck commitments.
              </p>
            </div>
            <span className="rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-100">
              Read-only here
            </span>
          </div>
          {deckLocations.map((location) => {
            const counts = quantityByLocation[location.id] ?? {
              quantity: 0,
              entries: 0,
            };
            const effectiveVisibility = effectiveLocationVisibility(location);
            return (
              <div
                key={location.id}
                className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-sm"
              >
                <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-emerald-100">
                      {location.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Tied deck: {location.deck?.name ?? "deleted deck"}
                    </p>
                  </div>
                  <span className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-100">
                    Deck
                  </span>
                  <span className="text-zinc-300">
                    {location.ownerPlayer.displayName}
                  </span>
                  <span className="text-zinc-300">
                    {counts.quantity} cards / {counts.entries} entries
                  </span>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Visibility: {visibilityLabel(location.visibility)} to{" "}
                  {effectiveVisibilityLabel(effectiveVisibility)}. Rename,
                  delete, and move controls are handled from the deck.
                </p>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Normal locations</h2>
            <p className="text-sm text-zinc-400">
              Boxes, binders, shelves, and other editable inventory locations,
              grouped like the deck folder view.
            </p>
          </div>
          <span className="text-sm text-zinc-500">
            {normalLocations.length} locations
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-3 rounded border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Location tree</h3>
              <span className="text-xs text-zinc-500">
                {normalLocations.length}
              </span>
            </div>
            <nav className="space-y-1 text-sm" aria-label="Locations tree">
              <div className="flex items-center justify-between rounded bg-sky-950 px-2 py-1 text-sky-100">
                <span>All normal locations</span>
                <span className="text-xs text-zinc-400">
                  {normalLocations.length}
                </span>
              </div>
              <div className="space-y-1 pt-1">
                {normalLocationGroups.map((ownerGroup) => (
                  <details key={ownerGroup.id} open>
                    <summary className="list-none">
                      <div className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-zinc-300 hover:bg-zinc-900">
                        <span className="w-4 text-center text-zinc-500">
                          -
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {ownerGroup.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {ownerGroup.quantity}
                        </span>
                      </div>
                    </summary>
                    <div className="ml-3 space-y-0.5 border-l border-zinc-800 pl-2">
                      {ownerGroup.types.map((typeGroup) => (
                        <details key={`${ownerGroup.id}-${typeGroup.label}`} open>
                          <summary className="list-none">
                            <div className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-zinc-300 hover:bg-zinc-900">
                              <span className="w-4 text-center text-zinc-500">
                                -
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {typeGroup.label}
                              </span>
                              <span className="text-xs text-zinc-500">
                                {typeGroup.locations.length}
                              </span>
                            </div>
                          </summary>
                          <div className="ml-3 space-y-0.5 border-l border-zinc-800 pl-2">
                            {typeGroup.locations.map((location) => {
                              const counts = countsForLocation(location.id);
                              const effectiveVisibility =
                                effectiveLocationVisibility(location);
                              return (
                                <div
                                  key={location.id}
                                  className="flex min-w-0 items-center justify-between gap-2 rounded px-1 py-0.5 text-zinc-300 hover:bg-zinc-900"
                                >
                                  <span className="min-w-0 truncate">
                                    {location.name}
                                  </span>
                                  <span
                                    className={cn(
                                      "rounded border px-1.5 py-0.5 text-[11px]",
                                      visibilityTone(effectiveVisibility),
                                    )}
                                  >
                                    {counts.quantity}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </nav>
          </aside>
          <div className="space-y-3">
            {normalLocationGroups.map((ownerGroup) => (
              <details
                key={ownerGroup.id}
                open
                className="rounded border border-zinc-800 bg-zinc-950/40"
              >
                <summary className="list-none border-b border-zinc-800 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-zinc-100">
                        {ownerGroup.name}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        {ownerGroup.types.length} location groups
                      </p>
                    </div>
                    <span className="text-sm text-zinc-300">
                      {ownerGroup.quantity} cards / {ownerGroup.entries} entries
                    </span>
                  </div>
                </summary>
                <div className="space-y-3 p-3">
                  {ownerGroup.types.map((typeGroup) => (
                    <details
                      key={`${ownerGroup.id}-${typeGroup.label}`}
                      open
                      className="border-l border-zinc-800 pl-3"
                    >
                      <summary className="list-none rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-900">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-zinc-200">
                            {typeGroup.label}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {typeGroup.locations.length} locations /{" "}
                            {typeGroup.quantity} cards
                          </span>
                        </div>
                      </summary>
                      <div className="mt-2 space-y-2">
                        {typeGroup.locations.map((location) => {
                          const counts = countsForLocation(location.id);
                          const effectiveVisibility =
                            effectiveLocationVisibility(location);
                          const canDeleteLocation =
                            counts.quantity <= 0 &&
                            location.normalizedName !== "unassigned";
                          return (
                            <article
                              key={location.id}
                              className="rounded border border-zinc-800 bg-zinc-950/50"
                            >
                              <div className="grid gap-3 p-3 md:grid-cols-[1.4fr_auto_auto_auto] md:items-center">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-semibold text-zinc-100">
                                      {location.name}
                                    </h4>
                                    {!location.active ? (
                                      <span className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                                        Inactive
                                      </span>
                                    ) : null}
                                    <span
                                      className={cn(
                                        "rounded border px-2 py-0.5 text-xs",
                                        visibilityTone(effectiveVisibility),
                                      )}
                                    >
                                      {effectiveVisibilityLabel(
                                        effectiveVisibility,
                                      )}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {location.description ||
                                      "No description set."}
                                  </p>
                                </div>
                                <div className="text-sm text-zinc-300">
                                  <span className="font-semibold text-zinc-100">
                                    {counts.quantity}
                                  </span>{" "}
                                  cards
                                </div>
                                <div className="text-sm text-zinc-300">
                                  <span className="font-semibold text-zinc-100">
                                    {counts.entries}
                                  </span>{" "}
                                  entries
                                </div>
                                <details className="group justify-self-start md:justify-self-end">
                                  <summary className="cursor-pointer list-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 transition-colors hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                                    Manage
                                  </summary>
                                  <div className="mt-3 space-y-4 border-t border-zinc-800 pt-3 md:w-[min(720px,80vw)]">
                                    <form
                                      action={updateLocationAction}
                                      className="grid gap-3 md:grid-cols-6"
                                    >
                                      <input
                                        type="hidden"
                                        name="locationId"
                                        value={location.id}
                                      />
                                      <label className={filterFieldClass}>
                                        Name
                                        <input
                                          name="name"
                                          defaultValue={location.name}
                                          className={cn(
                                            filterInputClass,
                                            "mt-1 w-full",
                                          )}
                                        />
                                      </label>
                                      <label className={filterFieldClass}>
                                        Type
                                        <input
                                          name="type"
                                          defaultValue={location.type ?? ""}
                                          className={cn(
                                            filterInputClass,
                                            "mt-1 w-full",
                                          )}
                                        />
                                      </label>
                                      <label
                                        className={cn(
                                          filterFieldClass,
                                          "md:col-span-2",
                                        )}
                                      >
                                        Description
                                        <input
                                          name="description"
                                          defaultValue={
                                            location.description ?? ""
                                          }
                                          className={cn(
                                            filterInputClass,
                                            "mt-1 w-full",
                                          )}
                                        />
                                      </label>
                                      <label className={filterFieldClass}>
                                        Visibility
                                        <select
                                          name="visibility"
                                          defaultValue={location.visibility}
                                          className={cn(
                                            filterSelectClass,
                                            "mt-1 w-full",
                                          )}
                                        >
                                          <option value={Visibility.INHERIT}>
                                            Use account default
                                          </option>
                                          <option value={Visibility.PRIVATE}>
                                            Private
                                          </option>
                                          <option value={Visibility.PUBLIC}>
                                            Public
                                          </option>
                                        </select>
                                      </label>
                                      <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
                                        <input
                                          type="checkbox"
                                          name="active"
                                          defaultChecked={location.active}
                                        />{" "}
                                        Active
                                      </label>
                                      <SubmitButton
                                        pendingLabel="Saving..."
                                        className={cn(
                                          filterPrimaryButtonClass,
                                          "md:col-span-2",
                                        )}
                                      >
                                        Save location
                                      </SubmitButton>
                                    </form>
                                    <div className="rounded border border-red-950/70 bg-red-950/10 p-3">
                                      <h5 className="text-sm font-semibold text-red-100">
                                        Danger zone
                                      </h5>
                                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                        <LocationContentsDeleteForm
                                          locationId={location.id}
                                          locationName={location.name}
                                          entryCount={counts.entries}
                                          cardCount={counts.quantity}
                                          deleteAction={
                                            deleteLocationContentsAction
                                          }
                                        />
                                        <form
                                          action={deleteLocationAction}
                                          className="space-y-2 rounded border border-zinc-800 p-2"
                                        >
                                          <input
                                            type="hidden"
                                            name="locationId"
                                            value={location.id}
                                          />
                                          <label className="flex items-center gap-2 text-xs text-zinc-300">
                                            <input
                                              type="checkbox"
                                              name="confirmDelete"
                                              disabled={!canDeleteLocation}
                                            />
                                            Confirm deleting this unused
                                            location.
                                          </label>
                                          <SubmitButton
                                            pendingLabel="Deleting..."
                                            className={filterDangerButtonClass}
                                            disabled={!canDeleteLocation}
                                          >
                                            Delete unused location
                                          </SubmitButton>
                                          {!canDeleteLocation ? (
                                            <p className="text-xs text-amber-300">
                                              {counts.quantity > 0
                                                ? "Move or remove inventory before deleting this location."
                                                : "The default Unassigned location cannot be deleted."}
                                            </p>
                                          ) : null}
                                        </form>
                                      </div>
                                    </div>
                                  </div>
                                </details>
                              </div>
                              <p className="border-t border-zinc-900 px-3 py-2 text-xs text-zinc-500">
                                Visibility setting:{" "}
                                {visibilityLabel(location.visibility)} to{" "}
                                {effectiveVisibilityLabel(effectiveVisibility)}
                              </p>
                            </article>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
