export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  LocationSearchSelect,
  NewLocationParentFields,
} from "@/components/LocationSearchSelect";
import { vaultSectionHref } from "@/lib/vault-navigation";
import {
  LocationContentsDeleteForm,
  type LocationContentsDeleteResult,
} from "@/components/LocationContentsDeleteForm";
import { LocationMoveForm } from "@/components/LocationMoveForm";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, getCurrentUser, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moveInventoryStorageBatch } from "@/lib/inventory-storage-move";
import { storageSections, isVault } from "@/lib/storage-sections";
import { VaultSectionMap } from "@/components/VaultSectionMap";
import {
  browseLocations,
  selectedBrowseLocation,
  locationBrowseHref,
  type LocationBrowseParams,
} from "@/lib/location-browser";
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
  filterButtonClass,
  filterDangerButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPanelClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";
import {
  bulkDeleteInventoryItems,
  buildLocationTree,
  createLocation,
  deleteUnusedLocation,
  ensureDefaultLocation,
  updateLocation,
  withLocationPaths,
} from "@/lib/inventory-locations";
import {
  isReservedLocationTypeName,
  locationTypeNameFromForm,
  normalizeLocationTypeName,
} from "@/lib/location-types";

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

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const browseParams: LocationBrowseParams = {};
  for (const key of [
    "q",
    "parent",
    "page",
    "treePage",
    "edit",
    "selected",
    "panel",
    "view",
  ] as const) {
    const value = rawParams[key];
    browseParams[key] = typeof value === "string" ? value : value?.[0];
  }
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
  const allLocationTypes = await prisma.locationType.findMany({
    where: { active: true },
    include: {
      createdByUser: {
        select: { id: true, username: true, displayName: true },
      },
    },
    orderBy: { name: "asc" },
  });
  const locationTypes = allLocationTypes.filter(
    (type) => !isReservedLocationTypeName(type.name),
  );
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
        by: ["locationId", "locationSection"],
        where: {
          locationId: { in: locations.map((l) => l.id) },
          quantity: { gt: 0 },
        },
        _sum: { quantity: true },
        _count: true,
      })
    : [];
  const quantityByLocation: Record<
    string,
    { quantity: number; entries: number }
  > = {};
  const sectionsByLocation = new Map<
    string,
    Array<{ name: string; quantity: number }>
  >();
  for (const row of quantities) {
    const locationId = row.locationId ?? "";
    const current = quantityByLocation[locationId] ?? {
      quantity: 0,
      entries: 0,
    };
    current.quantity += row._sum.quantity ?? 0;
    current.entries += row._count;
    quantityByLocation[locationId] = current;
    if (row.locationSection) {
      const sections = sectionsByLocation.get(locationId) ?? [];
      sections.push({
        name: row.locationSection,
        quantity: row._sum.quantity ?? 0,
      });
      sections.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      sectionsByLocation.set(locationId, sections);
    }
  }
  const locationsWithPaths = withLocationPaths(locations);
  const normalLocations = locationsWithPaths.filter(
    (location) => location.kind === InventoryLocationKind.NORMAL,
  );
  const deckLocations = locationsWithPaths.filter(
    (location) => location.kind === InventoryLocationKind.DECK,
  );
  const browser = browseLocations(normalLocations, browseParams);
  type NormalLocation = (typeof normalLocations)[number];
  type NormalLocationTreeNode = NormalLocation & {
    children: NormalLocationTreeNode[];
  };
  const countsForLocation = (locationId: string) =>
    quantityByLocation[locationId] ?? { quantity: 0, entries: 0 };
  const allLocationTypeUses = await prisma.inventoryLocation.findMany({
    where: { type: { not: null } },
    select: { type: true, ownerPlayerId: true },
  });
  const locationTypeUsage = new Map<
    string,
    { locations: number; ownerIds: Set<string> }
  >();
  for (const location of allLocationTypeUses) {
    const key = normalizeLocationTypeName(location.type || "");
    if (!key) continue;
    const usage = locationTypeUsage.get(key) ?? {
      locations: 0,
      ownerIds: new Set<string>(),
    };
    usage.locations += 1;
    usage.ownerIds.add(location.ownerPlayerId);
    locationTypeUsage.set(key, usage);
  }
  const normalLocationTrees = new Map(
    owners.map((owner) => [
      owner.id,
      buildLocationTree(
        normalLocations.filter(
          (location) => location.ownerPlayerId === owner.id,
        ),
      ) as NormalLocationTreeNode[],
    ]),
  );
  const normalLocationById = new Map(
    normalLocations.map((location) => [location.id, location]),
  );
  const selectedLocation = selectedBrowseLocation(
    normalLocations,
    browser,
    browseParams,
  );
  const deckView = browseParams.view === "decks";
  const deckBrowser = browseLocations(deckLocations, {
    q: browseParams.q,
    page: browseParams.page,
  });
  const panel = browseParams.panel;
  const browseHref = locationBrowseHref(browseParams, {
    panel: undefined,
    edit: undefined,
  });
  const selectionHref = (id: string) =>
    locationBrowseHref(browseParams, {
      selected: id,
      edit: undefined,
      panel: undefined,
    });
  const isDescendantOf = (candidateId: string, ancestorId: string) => {
    const visited = new Set<string>();
    let current = normalLocationById.get(candidateId);
    while (current?.parentLocationId && !visited.has(current.id)) {
      if (current.parentLocationId === ancestorId) return true;
      visited.add(current.id);
      current = normalLocationById.get(current.parentLocationId);
    }
    return false;
  };
  const rolledUpCounts = new Map<
    string,
    { quantity: number; entries: number }
  >();
  const calculateRolledUpCounts = (
    node: NormalLocationTreeNode,
  ): { quantity: number; entries: number } => {
    const direct = countsForLocation(node.id);
    const total: { quantity: number; entries: number } = node.children.reduce(
      (sum, child) => {
        const childTotal = calculateRolledUpCounts(child);
        return {
          quantity: sum.quantity + childTotal.quantity,
          entries: sum.entries + childTotal.entries,
        };
      },
      { ...direct },
    );
    rolledUpCounts.set(node.id, total);
    return total;
  };
  normalLocationTrees.forEach((roots) =>
    roots.forEach(calculateRolledUpCounts),
  );

  function renderLocationTreeNodes(nodes: NormalLocation[]) {
    return nodes.map((location) => {
      const direct = countsForLocation(location.id);
      const total = rolledUpCounts.get(location.id) ?? direct;
      return (
        <a
          key={location.id}
          href={locationBrowseHref({}, { parent: location.id })}
          className="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-2 text-zinc-300 hover:bg-zinc-900"
        >
          <span className="min-w-0 break-words">
            {location.name}
            {adminModeActive ? (
              <span className="block text-xs text-zinc-500">
                {location.ownerPlayer.displayName}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px]",
              visibilityTone(effectiveLocationVisibility(location)),
            )}
            title={`${direct.quantity} cards directly here; ${total.quantity} including sub-locations`}
          >
            {direct.quantity === total.quantity
              ? direct.quantity
              : `${direct.quantity} / ${total.quantity}`}
          </span>
        </a>
      );
    });
  }

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
      parentLocationId: String(fd.get("parentLocationId") || "") || null,
      description: String(fd.get("description") || "") || null,
      type: await locationTypeNameFromForm(prisma, fd, {
        createdByUserId: ctx.user.id,
      }),
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
    redirect(
      locationBrowseHref(browseParams, {
        panel: undefined,
        edit: undefined,
        selected: location.id,
        view: undefined,
      }),
    );
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
      parentLocationId: String(fd.get("parentLocationId") || "") || null,
      description: String(fd.get("description") || "") || null,
      type: await locationTypeNameFromForm(prisma, fd, {
        createdByUserId: ctx.user.id,
      }),
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
    const source = await prisma.inventoryLocation.findUnique({
      where: { id: sourceLocationId },
    });
    const destination = await prisma.inventoryLocation.findUnique({
      where: { id: destinationLocationId },
    });
    if (
      !source ||
      !destination ||
      source.ownerPlayerId !== destination.ownerPlayerId
    )
      throw new Error("Source and destination must belong to the same owner.");
    if (source.kind !== "NORMAL" || source.systemManaged)
      throw new Error("Use the deck return workflow for committed inventory.");
    await moveInventoryStorageBatch(prisma, {
      actorUserId: ctx.user.id,
      destinationLocationId,
      sourceLocationId,
      where: { locationId: sourceLocationId },
      allowedOwnerId: ctx.admin ? undefined : ctx.playerId || undefined,
      reason: "Move all inventory from one location to another.",
    });
    revalidatePath("/locations");
    revalidatePath("/inventory");
    redirect(
      locationBrowseHref(browseParams, {
        panel: undefined,
        edit: undefined,
        selected: sourceLocationId,
      }),
    );
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
    redirect(
      locationBrowseHref(browseParams, {
        panel: undefined,
        edit: undefined,
        selected: undefined,
      }),
    );
  }

  async function deleteLocationTypeAction(fd: FormData) {
    "use server";
    const ctx = await getActionContext();
    const id = String(fd.get("locationTypeId") || "");
    const replacementTypeId = String(fd.get("replacementTypeId") || "");
    if (fd.get("confirmDeleteType") !== "on") {
      throw new Error("Confirm deletion before removing a location type.");
    }
    const locationType = await prisma.locationType.findUnique({
      where: { id },
    });
    if (!locationType || !locationType.active) {
      throw new Error("Location type not found.");
    }
    if (isReservedLocationTypeName(locationType.name)) {
      throw new Error("Deck is a system-managed location type.");
    }
    const typeWhere = {
      type: { equals: locationType.name, mode: "insensitive" as const },
    };
    const usage = await prisma.inventoryLocation.findMany({
      where: typeWhere,
      select: { id: true, ownerPlayerId: true },
    });

    if (!ctx.admin) {
      if (locationType.createdByUserId !== ctx.user.id) {
        throw new Error("You can only delete location types you created.");
      }
      if (!ctx.playerId) {
        throw new Error("Your account is not linked to an inventory owner.");
      }
      const usedByAnotherOwner = usage.some(
        (location) => location.ownerPlayerId !== ctx.playerId,
      );
      if (usedByAnotherOwner) {
        throw new Error(
          "This type is used by another user. Ask an admin to migrate or delete it.",
        );
      }
      const cleared = await prisma.inventoryLocation.updateMany({
        where: { ...typeWhere, ownerPlayerId: ctx.playerId },
        data: { type: null },
      });
      await prisma.locationType.delete({ where: { id } });
      await prisma.inventoryAuditLog.create({
        data: {
          changedByUserId: ctx.user.id,
          changeType: "location_type_deleted",
          beforeJson: locationType as any,
          afterJson: {
            deleted: true,
            id,
            clearedLocationCount: cleared.count,
          },
          reason: "Location type deleted by creator.",
        },
      });
    } else {
      let replacementType: { id: string; name: string } | null = null;
      if (usage.length) {
        if (!replacementTypeId) {
          throw new Error("Choose a replacement type before admin deletion.");
        }
        if (replacementTypeId === id) {
          throw new Error("Replacement type must be different.");
        }
        replacementType = await prisma.locationType.findUnique({
          where: { id: replacementTypeId },
          select: { id: true, name: true },
        });
        if (!replacementType) throw new Error("Replacement type not found.");
      }
      const migrated = replacementType
        ? await prisma.inventoryLocation.updateMany({
            where: typeWhere,
            data: { type: replacementType.name },
          })
        : { count: 0 };
      await prisma.locationType.delete({ where: { id } });
      await prisma.inventoryAuditLog.create({
        data: {
          changedByUserId: ctx.user.id,
          changeType: "location_type_deleted",
          beforeJson: locationType as any,
          afterJson: {
            deleted: true,
            id,
            migratedLocationCount: migrated.count,
            replacementTypeId: replacementType?.id ?? null,
            replacementTypeName: replacementType?.name ?? null,
          },
          reason: replacementType
            ? "Location type deleted by admin with migration."
            : "Unused location type deleted by admin.",
        },
      });
    }

    revalidatePath("/locations");
    revalidatePath("/inventory");
    revalidatePath("/public/inventory");
  }

  return (
    <main className="locations-page">
      <Nav />
      <header className="locations-heading">
        <div>
          <h1 className="text-2xl font-bold">Locations</h1>
          <p className="text-sm text-[var(--app-muted)]">
            {adminModeActive ? "All owners · Admin mode" : "Your storage"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={locationBrowseHref(browseParams, {
              panel: "types",
              edit: undefined,
            })}
            className={filterButtonClass}
          >
            Location types
          </a>
          <a
            href={locationBrowseHref(browseParams, {
              panel: "create",
              edit: undefined,
            })}
            className={filterPrimaryButtonClass}
          >
            Create location
          </a>
        </div>
      </header>
      <nav className="locations-view-nav" aria-label="Location views">
        <a href="/locations" aria-current={!deckView ? "page" : undefined}>
          Storage <span>{normalLocations.length}</span>
        </a>
        <a
          href="/locations?view=decks"
          aria-current={deckView ? "page" : undefined}
        >
          Deck locations <span>{deckLocations.length}</span>
        </a>
      </nav>
      {panel === "create" || panel === "types" ? (
        <div className="space-y-3">
          <a href={browseHref} className="inline-block py-2 text-sm underline">
            Back to locations
          </a>
          {panel === "create" ? (
            <section className={cn(filterPanelClass, "space-y-3")}>
              <h2 className="text-xl font-semibold">Create location</h2>
              <form
                action={createLocationAction}
                className="grid gap-3 md:grid-cols-2"
              >
                <NewLocationParentFields
                  owners={
                    adminModeActive
                      ? owners.map((owner) => ({
                          id: owner.id,
                          name: owner.displayName,
                        }))
                      : undefined
                  }
                  defaultOwnerId={
                    selectedLocation?.ownerPlayerId ?? selectedOwnerId
                  }
                  defaultParentId={
                    selectedLocation?.active &&
                    selectedLocation.normalizedName !== "unassigned"
                      ? selectedLocation.id
                      : ""
                  }
                  locations={normalLocations
                    .filter(
                      (location) =>
                        location.active &&
                        !location.systemManaged &&
                        location.normalizedName !== "unassigned",
                    )
                    .map((location) => ({
                      id: location.id,
                      name: location.path,
                      ownerPlayerId: location.ownerPlayerId,
                    }))}
                />
                <label className="text-sm">
                  Name
                  <input
                    name="name"
                    required
                    placeholder="Box-0001"
                    className={cn(filterInputClass, "mt-1 w-full")}
                  />
                </label>
                <select
                  name="type"
                  defaultValue=""
                  className={filterSelectClass}
                  aria-label="Location type"
                >
                  <option value="">Choose type</option>
                  {!locationTypes.some((type) => isVault(type.name)) && (
                    <option value="Vault">Vault</option>
                  )}
                  {locationTypes.map((type) => (
                    <option key={type.id} value={type.name}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <input
                  name="newType"
                  aria-label="New location type"
                  placeholder="Or create type"
                  className={filterInputClass}
                />
                <input
                  name="description"
                  aria-label="Description"
                  placeholder="description optional"
                  className={filterInputClass}
                />
                <select
                  name="visibility"
                  aria-label="Visibility"
                  defaultValue={Visibility.INHERIT}
                  className={filterSelectClass}
                >
                  <option value={Visibility.INHERIT}>
                    Use account default
                  </option>
                  <option value={Visibility.PRIVATE}>Private</option>
                  <option value={Visibility.PUBLIC}>Public</option>
                </select>
                <SubmitButton
                  pendingLabel="Creating location…"
                  className={filterPrimaryButtonClass}
                >
                  Create Location
                </SubmitButton>
                <p className="text-xs text-zinc-400 md:col-span-2">
                  Choose Vault to automatically provide Sect 0–5 with an
                  advisory capacity of 85 cards each. Other location types
                  retain arbitrary sections.
                </p>
              </form>
            </section>
          ) : (
            <section className={cn(filterPanelClass, "space-y-3")}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Location types</h2>
                  <p className="text-sm text-zinc-400">
                    Shared type list used by every user when creating and
                    filtering locations.
                  </p>
                </div>
                <span className="text-sm text-zinc-500">
                  {locationTypes.length} active types
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {locationTypes.map((type) => {
                  const usage = locationTypeUsage.get(
                    normalizeLocationTypeName(type.name),
                  ) ?? { locations: 0, ownerIds: new Set<string>() };
                  const usedByAnotherOwner = user.playerId
                    ? Array.from(usage.ownerIds).some(
                        (ownerId) => ownerId !== user.playerId,
                      )
                    : usage.ownerIds.size > 0;
                  const createdByCurrentUser = type.createdByUserId === user.id;
                  const normalUserCanDelete =
                    !adminModeActive &&
                    createdByCurrentUser &&
                    !usedByAnotherOwner;
                  const adminReplacementRequired =
                    adminModeActive && usage.locations > 0;
                  return (
                    <details
                      key={type.id}
                      className="rounded border border-zinc-800 bg-zinc-950/60 p-3"
                    >
                      <summary className="list-none">
                        <div className="flex cursor-pointer items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-zinc-100">
                              {type.name}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {usage.locations} locations /{" "}
                              {usage.ownerIds.size} owners
                            </p>
                          </div>
                          <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                            Manage
                          </span>
                        </div>
                      </summary>
                      <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
                        <div className="text-xs text-zinc-400">
                          Created by:{" "}
                          {type.createdByUser?.displayName ||
                            type.createdByUser?.username ||
                            "system / imported"}
                        </div>
                        {adminModeActive ? (
                          <form
                            action={deleteLocationTypeAction}
                            className="space-y-2"
                          >
                            <input
                              type="hidden"
                              name="locationTypeId"
                              value={type.id}
                            />
                            <label className={filterFieldClass}>
                              Migrate locations to
                              <select
                                name="replacementTypeId"
                                required={adminReplacementRequired}
                                defaultValue=""
                                className={cn(filterSelectClass, "mt-1 w-full")}
                              >
                                <option value="">
                                  {adminReplacementRequired
                                    ? "Choose replacement"
                                    : "No replacement needed"}
                                </option>
                                {locationTypes
                                  .filter(
                                    (candidate) => candidate.id !== type.id,
                                  )
                                  .map((candidate) => (
                                    <option
                                      key={candidate.id}
                                      value={candidate.id}
                                    >
                                      {candidate.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2 text-xs text-zinc-300">
                              <input type="checkbox" name="confirmDeleteType" />
                              Delete this type
                              {usage.locations
                                ? ` and migrate ${usage.locations} locations.`
                                : "."}
                            </label>
                            <SubmitButton
                              pendingLabel="Deleting type..."
                              className={filterDangerButtonClass}
                            >
                              Delete type
                            </SubmitButton>
                          </form>
                        ) : (
                          <form
                            action={deleteLocationTypeAction}
                            className="space-y-2"
                          >
                            <input
                              type="hidden"
                              name="locationTypeId"
                              value={type.id}
                            />
                            <label className="flex items-center gap-2 text-xs text-zinc-300">
                              <input
                                type="checkbox"
                                name="confirmDeleteType"
                                disabled={!normalUserCanDelete}
                              />
                              Delete this type
                            </label>
                            <SubmitButton
                              pendingLabel="Deleting type..."
                              className={filterDangerButtonClass}
                              disabled={!normalUserCanDelete}
                            >
                              Delete type
                            </SubmitButton>
                            {!createdByCurrentUser ? (
                              <p className="text-xs text-zinc-500">
                                Only the creator or an admin can delete this
                                shared type.
                              </p>
                            ) : usedByAnotherOwner ? (
                              <p className="text-xs text-amber-300">
                                Another user has locations using this type. Ask
                                an admin to migrate it.
                              </p>
                            ) : usage.locations ? (
                              <p className="text-xs text-zinc-500">
                                Deleting clears this type from your matching
                                locations.
                              </p>
                            ) : null}
                          </form>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      ) : deckView ? (
        <section className="space-y-3" aria-label="Deck locations">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Deck locations</h2>
            <span className="text-sm text-[var(--app-muted)]">
              Read-only here · Managed from each deck
            </span>
          </div>
          <form
            action="/locations"
            method="get"
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="view" value="decks" />
            <label className="min-w-0 flex-1 text-sm">
              Search deck locations
              <input
                name="q"
                defaultValue={browseParams.q ?? ""}
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
            <button className={filterPrimaryButtonClass}>Find decks</button>
          </form>
          <p role="status" className="text-sm text-[var(--app-muted)]">
            {deckBrowser.total} deck locations · Page {deckBrowser.page} of{" "}
            {deckBrowser.pages}
          </p>
          <div className="space-y-2">
            {deckBrowser.items.map((location) => {
              const counts = countsForLocation(location.id);
              return (
                <article
                  key={location.id}
                  className={cn(
                    filterPanelClass,
                    "flex flex-wrap justify-between gap-3",
                  )}
                >
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">
                      {location.path}
                    </h3>
                    <p className="text-sm text-[var(--app-muted)]">
                      {location.ownerPlayer.displayName} ·{" "}
                      {effectiveVisibilityLabel(
                        effectiveLocationVisibility(location),
                      )}
                    </p>
                    <p className="text-sm">
                      {counts.quantity.toLocaleString()} copies ·{" "}
                      {counts.entries.toLocaleString()} entries
                    </p>
                  </div>
                  {location.deck ? (
                    <a
                      className={filterButtonClass}
                      href={`/decks/${location.deck.id}`}
                    >
                      Open deck
                    </a>
                  ) : (
                    <span className="text-sm">Deck no longer available</span>
                  )}
                </article>
              );
            })}
            {!deckBrowser.items.length && (
              <p className={filterPanelClass}>No deck locations match.</p>
            )}
          </div>
          <nav aria-label="Deck location pages" className="flex gap-4 text-sm">
            {deckBrowser.page > 1 && (
              <a
                className="underline"
                href={locationBrowseHref({
                  view: "decks",
                  q: browseParams.q,
                  page: String(deckBrowser.page - 1),
                })}
              >
                Previous decks
              </a>
            )}
            {deckBrowser.page < deckBrowser.pages && (
              <a
                className="underline"
                href={locationBrowseHref({
                  view: "decks",
                  q: browseParams.q,
                  page: String(deckBrowser.page + 1),
                })}
              >
                Next decks
              </a>
            )}
          </nav>
        </section>
      ) : (
        <section
          id="normal-locations"
          className="space-y-3 scroll-mt-4"
          aria-label="Normal locations"
        >
          <h2 className="sr-only">Normal locations</h2>
          <form
            action="/locations#normal-locations"
            method="get"
            className="locations-search"
          >
            {browseParams.parent && (
              <input type="hidden" name="parent" value={browseParams.parent} />
            )}
            <label className="min-w-0 text-sm">
              Search locations{browser.parent ? " in this branch" : ""}
              <input
                name="q"
                defaultValue={browseParams.q ?? ""}
                placeholder="Name, full storage path, or type"
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
            <button className={filterPrimaryButtonClass}>Find locations</button>
            {(browseParams.q || browseParams.parent) && (
              <a
                href="/locations#normal-locations"
                className="py-2 text-sm underline"
              >
                Clear search and branch
              </a>
            )}
          </form>
          <div className="locations-workspace">
            <aside className="locations-browser" aria-label="Storage browser">
              <p role="status" className="text-sm text-[var(--app-muted)]">
                {browser.total} matching locations · Page {browser.page} of{" "}
                {browser.pages}
              </p>
              <details
                className="locations-tree"
                open={Boolean(browser.parent)}
              >
                <summary className="cursor-pointer py-2 text-sm font-medium">
                  Browse branches
                </summary>
                <nav
                  className="max-h-64 space-y-1 overflow-y-auto text-sm"
                  aria-label="Locations tree"
                >
                  <h3 className="sr-only">Location tree</h3>
                  <a
                    href="/locations#normal-locations"
                    className="block py-2 underline"
                  >
                    All normal locations
                  </a>
                  {browser.breadcrumbs.map((location) => (
                    <a
                      key={location.id}
                      href={locationBrowseHref({}, { parent: location.id })}
                      aria-current={
                        location.id === browser.parent?.id
                          ? "location"
                          : undefined
                      }
                      className="block break-words py-2 underline"
                    >
                      {location.name}
                    </a>
                  ))}
                  <p className="text-xs text-[var(--app-muted)]">
                    {browser.parent ? "Sub-locations" : "Top-level locations"} ·{" "}
                    {browser.treeTotal}
                  </p>
                  {renderLocationTreeNodes(browser.treeItems)}
                  {!browser.treeItems.length && (
                    <p className="py-2">No sub-locations.</p>
                  )}
                  <div className="flex flex-wrap gap-3 py-2">
                    {browser.treePage > 1 && (
                      <a
                        href={locationBrowseHref(browseParams, {
                          treePage: String(browser.treePage - 1),
                          edit: undefined,
                        })}
                      >
                        Previous branches
                      </a>
                    )}
                    {browser.treePage < browser.treePages && (
                      <a
                        href={locationBrowseHref(browseParams, {
                          treePage: String(browser.treePage + 1),
                          edit: undefined,
                        })}
                      >
                        Next branches
                      </a>
                    )}
                  </div>
                </nav>
              </details>
              <div className="locations-results" aria-label="Location results">
                {browser.items.map((location) => {
                  const counts = countsForLocation(location.id);
                  const total = rolledUpCounts.get(location.id) ?? counts;
                  const sections = storageSections(
                    location.type,
                    sectionsByLocation.get(location.id) ?? [],
                  );
                  const room = sections.reduce(
                    (sum, section) =>
                      sum +
                      (section.capacity === null
                        ? 0
                        : Math.max(0, section.capacity - section.quantity)),
                    0,
                  );
                  return (
                    <a
                      key={location.id}
                      href={selectionHref(location.id)}
                      aria-current={
                        location.id === selectedLocation?.id
                          ? "true"
                          : undefined
                      }
                      className="locations-result"
                      data-location-result
                    >
                      <span className="break-words font-semibold">
                        {location.path}
                      </span>
                      <span className="text-xs text-[var(--app-muted)]">
                        {location.type || "Unsorted"}
                        {!location.active ? " · Inactive" : ""}
                        {adminModeActive
                          ? ` · ${location.ownerPlayer.displayName}`
                          : ""}
                      </span>
                      <span
                        className="text-sm"
                        title={`${counts.quantity} cards directly here; ${total.quantity} including sub-locations`}
                      >
                        {counts.quantity.toLocaleString()} copies
                        {total.quantity !== counts.quantity
                          ? ` · ${total.quantity.toLocaleString()} with children`
                          : ""}
                      </span>
                      {isVault(location.type) && (
                        <span className="text-xs text-[var(--app-muted)]">
                          {room.toLocaleString()} spaces in vault sections
                        </span>
                      )}
                    </a>
                  );
                })}
                {!browser.items.length && (
                  <p className="py-3 text-sm">
                    No locations match. Clear the search or choose another
                    branch.
                  </p>
                )}
              </div>
              <nav
                aria-label="Location pages"
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                {browser.page > 1 && (
                  <a
                    className="underline"
                    href={locationBrowseHref(browseParams, {
                      page: String(browser.page - 1),
                      selected: undefined,
                      edit: undefined,
                      panel: undefined,
                    })}
                  >
                    Previous locations
                  </a>
                )}
                <span className="text-[var(--app-muted)]">
                  {browser.page} / {browser.pages}
                </span>
                {browser.page < browser.pages && (
                  <a
                    className="underline"
                    href={locationBrowseHref(browseParams, {
                      page: String(browser.page + 1),
                      selected: undefined,
                      edit: undefined,
                      panel: undefined,
                    })}
                  >
                    Next locations
                  </a>
                )}
              </nav>
            </aside>
            <div className="locations-detail" id="location-detail">
              {selectedLocation ? (
                [selectedLocation].map((location) => {
                  const counts = countsForLocation(location.id);
                  const total = rolledUpCounts.get(location.id) ?? counts;
                  const effectiveVisibility =
                    effectiveLocationVisibility(location);
                  const canDeleteLocation =
                    counts.quantity <= 0 &&
                    location.normalizedName !== "unassigned" &&
                    !normalLocations.some(
                      (candidate) => candidate.parentLocationId === location.id,
                    );
                  const unsectionedQuantity =
                    counts.quantity -
                    (sectionsByLocation.get(location.id) ?? []).reduce(
                      (sum, section) => sum + section.quantity,
                      0,
                    );
                  return (
                    <article
                      key={location.id}
                      id={`location-${location.id}`}
                      aria-label="Selected location"
                    >
                      <header className="space-y-3">
                        <div>
                          <p className="text-sm text-[var(--app-muted)]">
                            {location.type || "Unsorted"} ·{" "}
                            {effectiveVisibilityLabel(effectiveVisibility)}
                            {!location.active ? " · Inactive" : ""}
                          </p>
                          <h2 className="break-words text-xl font-semibold">
                            {location.path}
                          </h2>
                          {adminModeActive && (
                            <p className="text-sm text-[var(--app-muted)]">
                              {location.ownerPlayer.displayName}
                            </p>
                          )}
                          {location.description && (
                            <p className="mt-1 break-words text-sm">
                              {location.description}
                            </p>
                          )}
                        </div>
                        <div className="locations-counts">
                          <p>
                            <strong>{counts.quantity.toLocaleString()}</strong>{" "}
                            copies here
                          </p>
                          <p>
                            <strong>{counts.entries.toLocaleString()}</strong>{" "}
                            entries
                          </p>
                          {total.quantity !== counts.quantity && (
                            <p>
                              <strong>{total.quantity.toLocaleString()}</strong>{" "}
                              copies with sub-locations
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={vaultSectionHref(
                              location.id,
                              null,
                              "displayMode=exact",
                            )}
                            className={filterPrimaryButtonClass}
                          >
                            Browse cards
                          </a>
                          <a
                            href={locationBrowseHref(browseParams, {
                              selected: location.id,
                              edit:
                                browseParams.edit === location.id
                                  ? undefined
                                  : location.id,
                              panel: undefined,
                            })}
                            className={filterButtonClass}
                            aria-expanded={browseParams.edit === location.id}
                          >
                            {browseParams.edit === location.id
                              ? "Close editor"
                              : "Manage"}
                          </a>
                          <a
                            href={locationBrowseHref(browseParams, {
                              selected: location.id,
                              edit: undefined,
                              panel: panel === "move" ? undefined : "move",
                            })}
                            className={filterButtonClass}
                            aria-expanded={panel === "move"}
                          >
                            {panel === "move"
                              ? "Cancel move"
                              : "Move all cards"}
                          </a>
                          <a
                            href={locationBrowseHref(
                              {},
                              { parent: location.id, selected: location.id },
                            )}
                            className={filterButtonClass}
                          >
                            Browse sub-locations
                          </a>
                        </div>
                      </header>
                      {panel === "move" && (
                        <section
                          className={cn(filterPanelClass, "mt-4 space-y-3")}
                          aria-label="Move an entire location"
                        >
                          <h3 className="font-semibold">
                            Move an entire location
                          </h3>
                          <p className="text-sm text-[var(--app-muted)]">
                            Moves cards directly in this location, not its
                            sub-locations. Stack identities and trade links are
                            preserved.
                          </p>
                          <LocationMoveForm
                            key={location.id}
                            moveAction={moveLocationAction}
                            source={{
                              id: location.id,
                              name: location.path,
                              ...counts,
                              effectiveVisibility,
                            }}
                            locations={normalLocations
                              .filter(
                                (candidate) =>
                                  candidate.id !== location.id &&
                                  candidate.ownerPlayerId ===
                                    location.ownerPlayerId &&
                                  candidate.active &&
                                  !candidate.systemManaged,
                              )
                              .map((candidate) => ({
                                id: candidate.id,
                                name: candidate.path,
                                ...countsForLocation(candidate.id),
                                effectiveVisibility:
                                  effectiveLocationVisibility(candidate),
                              }))}
                          />
                        </section>
                      )}
                      {browseParams.edit === location.id ? (
                        <div className="mt-3 w-full space-y-4 border-t border-zinc-800 pt-3">
                          <form
                            action={updateLocationAction}
                            className="grid gap-3 md:grid-cols-2"
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
                                className={cn(filterInputClass, "mt-1 w-full")}
                              />
                            </label>
                            <LocationSearchSelect
                              name="parentLocationId"
                              label="Parent"
                              defaultValue={location.parentLocationId ?? ""}
                              disabled={
                                location.normalizedName === "unassigned"
                              }
                              locations={normalLocations
                                .filter(
                                  (candidate) =>
                                    candidate.ownerPlayerId ===
                                      location.ownerPlayerId &&
                                    candidate.id !== location.id &&
                                    candidate.active &&
                                    !candidate.systemManaged &&
                                    candidate.normalizedName !== "unassigned" &&
                                    !isDescendantOf(candidate.id, location.id),
                                )
                                .map((candidate) => ({
                                  id: candidate.id,
                                  name: candidate.path,
                                }))}
                            />
                            <label className={filterFieldClass}>
                              Type
                              <select
                                name="type"
                                defaultValue={location.type ?? ""}
                                className={cn(filterSelectClass, "mt-1 w-full")}
                              >
                                <option value="">Unsorted</option>
                                {location.type &&
                                !locationTypes.some(
                                  (type) =>
                                    type.name.toLowerCase() ===
                                    location.type?.toLowerCase(),
                                ) ? (
                                  <option value={location.type}>
                                    {location.type}
                                  </option>
                                ) : null}
                                {locationTypes.map((type) => (
                                  <option key={type.id} value={type.name}>
                                    {type.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                name="newType"
                                aria-label="New location type"
                                placeholder="Or create type"
                                className={cn(filterInputClass, "mt-2 w-full")}
                              />
                            </label>
                            <label
                              className={cn(filterFieldClass, "md:col-span-2")}
                            >
                              Description
                              <input
                                name="description"
                                defaultValue={location.description ?? ""}
                                className={cn(filterInputClass, "mt-1 w-full")}
                              />
                            </label>
                            <label className={filterFieldClass}>
                              Visibility
                              <select
                                name="visibility"
                                defaultValue={location.visibility}
                                className={cn(filterSelectClass, "mt-1 w-full")}
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
                          <details className="rounded border border-red-950/70 bg-red-950/10 p-3">
                            <summary className="cursor-pointer text-sm font-semibold text-red-100">
                              Danger zone
                            </summary>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                              <LocationContentsDeleteForm
                                locationId={location.id}
                                locationName={location.name}
                                entryCount={counts.entries}
                                cardCount={counts.quantity}
                                deleteAction={deleteLocationContentsAction}
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
                                  Confirm deleting this unused location.
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
                                      : location.normalizedName === "unassigned"
                                        ? "The default Unassigned location cannot be deleted."
                                        : "Move or remove sub-locations before deleting this location."}
                                  </p>
                                ) : null}
                              </form>
                            </div>
                          </details>
                        </div>
                      ) : null}
                      {isVault(location.type) ? (
                        <div
                          className="mt-4 space-y-2"
                          aria-label={`${location.name} sections`}
                        >
                          <VaultSectionMap
                            location={{
                              id: location.id,
                              name: location.path,
                              type: location.type,
                              sections: storageSections(
                                location.type,
                                sectionsByLocation.get(location.id) ?? [],
                              ),
                            }}
                            unsectionedQuantity={unsectionedQuantity}
                          />
                          <a
                            className="inline-block py-2 text-sm underline"
                            href={vaultSectionHref(
                              location.id,
                              null,
                              "displayMode=exact",
                            )}
                          >
                            Select and move cards in this vault
                          </a>
                        </div>
                      ) : (
                        <section
                          className="mt-4 space-y-2"
                          aria-label="Sections"
                        >
                          <h3 className="font-semibold">Sections</h3>
                          <p className="text-sm text-[var(--app-muted)]">
                            Sections are created as cards are placed here.
                          </p>
                          <div className="max-h-80 space-y-2 overflow-y-auto">
                            {[
                              { name: "", quantity: unsectionedQuantity },
                              ...(sectionsByLocation.get(location.id) ?? []),
                            ].map((section) => (
                              <a
                                key={section.name}
                                href={vaultSectionHref(
                                  location.id,
                                  section.name,
                                  "displayMode=exact",
                                )}
                                className="locations-section-link"
                              >
                                <span className="break-words">
                                  {section.name || "Unsectioned"}
                                </span>
                                <span>
                                  {section.quantity.toLocaleString()} copies
                                </span>
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                      <p className="mt-4 text-xs text-[var(--app-muted)]">
                        Visibility setting:{" "}
                        {visibilityLabel(location.visibility)} to{" "}
                        {effectiveVisibilityLabel(effectiveVisibility)}
                      </p>
                    </article>
                  );
                })
              ) : (
                <p className={filterPanelClass}>
                  {browseParams.selected || browseParams.edit
                    ? "This location is unavailable. Choose a location from the list."
                    : "Choose a location to see its contents and storage details."}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
