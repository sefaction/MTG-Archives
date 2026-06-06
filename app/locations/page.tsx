export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getCurrentUser, isAdminUser, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createLocation,
  deleteUnusedLocation,
  ensureDefaultLocation,
  updateLocation,
} from "@/lib/inventory-locations";

async function getActionContext() {
  const user = await requireLogin();
  const userWithPlayer = await prisma.user.findUnique({
    where: { id: user.id },
    include: { player: true },
  });
  const admin = isAdminUser(user, userWithPlayer?.player);
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
  const isAdmin = isAdminUser(user, user.player);
  const owners = isAdmin
    ? await prisma.player.findMany({ orderBy: { displayName: "asc" } })
    : user.player
      ? [user.player]
      : [];
  for (const owner of owners) await ensureDefaultLocation(prisma, owner.id);
  const selectedOwnerId = user.playerId || owners[0]?.id || "";
  const locations = await prisma.inventoryLocation.findMany({
    where: isAdmin ? {} : { ownerPlayerId: selectedOwnerId },
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
  const quantities = await prisma.inventoryItem.groupBy({
    by: ["locationId"],
    where: {
      locationId: { in: locations.map((l) => l.id) },
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
    _count: true,
  });
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
      </div>

      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <h2 className="text-xl font-semibold">Create location</h2>
        <form
          action={createLocationAction}
          className="grid gap-2 md:grid-cols-5"
        >
          {isAdmin ? (
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
          <SubmitButton
            pendingLabel="Creating location…"
            className="border px-3 py-2"
          >
            Create Location
          </SubmitButton>
        </form>
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
