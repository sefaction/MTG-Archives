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
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
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

      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <h2 className="text-xl font-semibold">Create location</h2>
        <form
          action={createLocationAction}
          className="grid gap-2 md:grid-cols-7"
        >
          {adminModeActive ? (
            <select
              name="ownerPlayerId"
              defaultValue={selectedOwnerId}
              className="border p-2 bg-zinc-900"
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
            className="border p-2 bg-zinc-900"
          />
          <input
            name="type"
            placeholder="Box, Binder, Shelf"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="description"
            placeholder="description optional"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="visibility"
            defaultValue={Visibility.INHERIT}
            className="border p-2 bg-zinc-900"
          >
            <option value={Visibility.INHERIT}>Use account default</option>
            <option value={Visibility.PRIVATE}>Private</option>
            <option value={Visibility.PUBLIC}>Public</option>
          </select>
          <SubmitButton
            pendingLabel="Creating location…"
            className="border px-3 py-2"
          >
            Create Location
          </SubmitButton>
        </form>
      </section>

      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <h2 className="text-xl font-semibold">Move an entire location</h2>
        <p className="text-sm text-zinc-400">
          Move every inventory entry from one location to another. Matching
          destination rows are merged and the operation is transactional.
        </p>
        <LocationMoveForm
          moveAction={moveLocationAction}
          locations={locations.map((location) => {
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

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Existing locations</h2>
        {locations.map((location) => {
          const counts = quantityByLocation[location.id] ?? {
            quantity: 0,
            entries: 0,
          };
          return (
            <div
              key={location.id}
              className="rounded border border-zinc-800 p-3 space-y-2"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm text-zinc-400">
                <span>{location.ownerPlayer.displayName}</span>
                <span>
                  {counts.entries} inventory entries · {counts.quantity} total
                  cards
                </span>
                <span>
                  Visibility: {visibilityLabel(location.visibility)} →{" "}
                  {effectiveVisibilityLabel(
                    effectiveLocationVisibility(location),
                  )}
                </span>
              </div>
              <form
                action={updateLocationAction}
                className="grid gap-2 md:grid-cols-6"
              >
                <input type="hidden" name="locationId" value={location.id} />
                <input
                  name="name"
                  defaultValue={location.name}
                  className="border p-2 bg-zinc-900"
                />
                <input
                  name="type"
                  defaultValue={location.type ?? ""}
                  className="border p-2 bg-zinc-900"
                />
                <input
                  name="description"
                  defaultValue={location.description ?? ""}
                  className="border p-2 bg-zinc-900 md:col-span-2"
                />
                <label className="text-sm">
                  Visibility
                  <select
                    name="visibility"
                    defaultValue={location.visibility}
                    className="mt-1 w-full border p-2 bg-zinc-900"
                  >
                    <option value={Visibility.INHERIT}>
                      Use account default
                    </option>
                    <option value={Visibility.PRIVATE}>Private</option>
                    <option value={Visibility.PUBLIC}>Public</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={location.active}
                  />{" "}
                  Active
                </label>
                <SubmitButton
                  pendingLabel="Saving…"
                  className="border px-3 py-2"
                >
                  Save
                </SubmitButton>
              </form>
              <LocationContentsDeleteForm
                locationId={location.id}
                locationName={location.name}
                entryCount={counts.entries}
                cardCount={counts.quantity}
                deleteAction={deleteLocationContentsAction}
              />
              <form action={deleteLocationAction} className="space-y-2">
                <input type="hidden" name="locationId" value={location.id} />
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    name="confirmDelete"
                    disabled={
                      counts.quantity > 0 ||
                      location.normalizedName === "unassigned"
                    }
                  />
                  Confirm deleting this unused location.
                </label>
                <SubmitButton
                  pendingLabel="Deleting…"
                  className="border border-red-700 px-3 py-1 text-red-200"
                  disabled={
                    counts.quantity > 0 ||
                    location.normalizedName === "unassigned"
                  }
                >
                  Delete unused location
                </SubmitButton>
                {counts.quantity > 0 ? (
                  <p className="mt-1 text-xs text-amber-300">
                    This location still contains inventory. Move or remove those
                    cards before deleting it.
                  </p>
                ) : null}
              </form>
            </div>
          );
        })}
      </section>
    </main>
  );
}
