import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HandoffError } from "./card-handoffs";
import { bulkOwner } from "./bulk-cleanup-service";
import { locationIsBulk } from "./pull-scope";
import {
  buildLocationPathMap,
  normalizeLocationName,
  assertValidLocationName,
} from "./inventory-locations";
import { readStorageLayout } from "./storage-layout";
import { lockDeckOwners } from "./deck-write-fence";
import { lockInventoryDestinations } from "./inventory-capacity";

type Db = Prisma.TransactionClient;
export async function bulkDestinations(tx: Db, ownerId: string) {
  const rows = await tx.inventoryLocation.findMany({
      where: { ownerPlayerId: ownerId },
    }),
    byId = new Map(rows.map((row) => [row.id, row])),
    paths = buildLocationPathMap(rows);
  const usage = await tx.inventoryItem.groupBy({
    by: ["locationId", "locationSection"],
    where: {
      locationId: { in: rows.map((row) => row.id) },
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
  });
  const safe = (row: (typeof rows)[number]) => {
    const seen = new Set<string>();
    let current: typeof row | undefined = row;
    while (current) {
      if (
        seen.has(current.id) ||
        !current.active ||
        current.kind !== "NORMAL" ||
        current.systemManaged ||
        current.type === "Deck"
      )
        return false;
      seen.add(current.id);
      if (!current.parentLocationId) return true;
      current = byId.get(current.parentLocationId);
      if (!current) return false;
    }
    return false;
  };
  const locations = rows.filter(safe).map((row) => ({
    id: row.id,
    name: paths.get(row.id) ?? row.name,
    isBulk: locationIsBulk(row.id, byId),
  }));
  const destinations = rows
    .filter((row) => safe(row) && locationIsBulk(row.id, byId))
    .map((row) => {
      const layout = readStorageLayout(row.storageLayout, row.type),
        groups = usage.filter((group) => group.locationId === row.id);
      return {
        id: row.id,
        name: paths.get(row.id) ?? row.name,
        isBulk: true,
        capacity: layout.capacity,
        used: groups.reduce((n, g) => n + (g._sum.quantity ?? 0), 0),
        sections: layout.sections.map((section) => ({
          ...section,
          used: groups
            .filter((group) => group.locationSection === section.name)
            .reduce((n, g) => n + (g._sum.quantity ?? 0), 0),
        })),
      };
    });
  return { locations, destinations };
}
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("CREATE"),
      name: z.string().trim().min(1).max(120),
      capacity: z.number().int().positive().max(1_000_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("TAG"),
      locationId: z.string().min(1).max(200),
      isBulk: z.boolean(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export async function changeBulkLocation(
  db: PrismaClient,
  userId: string,
  raw: unknown,
) {
  const value = input.parse(raw);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const actor = await bulkOwner(tx, userId);
          await lockDeckOwners(tx, [userId]);
          if (value.action === "CREATE") {
            const name = assertValidLocationName(value.name),
              normalizedName = normalizeLocationName(name);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.playerId + ":bulk-box"},251126))`;
            if (
              await tx.inventoryLocation.findFirst({
                where: {
                  ownerPlayerId: actor.playerId,
                  parentLocationId: null,
                  normalizedName,
                },
              })
            )
              throw new HandoffError(
                "A box already has that name. Choose it or use another name.",
              );
            const box = await tx.inventoryLocation.create({
              data: {
                ownerPlayerId: actor.playerId,
                name,
                normalizedName,
                type: "Long box",
                isBulk: true,
                storageLayout: { capacity: value.capacity, sections: [] },
              },
            });
            await tx.inventoryAuditLog.create({
              data: {
                changedByUserId: userId,
                changeType: "bulk_box_created",
                beforeJson: {},
                afterJson: {
                  locationId: box.id,
                  name,
                  capacity: value.capacity,
                  isBulk: true,
                },
              },
            });
            return { id: box.id, message: `Created ${name}.` };
          }
          const before = await tx.inventoryLocation.findFirst({
            where: { id: value.locationId, ownerPlayerId: actor.playerId },
          });
          if (
            !before ||
            before.kind !== "NORMAL" ||
            before.systemManaged ||
            before.normalizedName === "unassigned" ||
            !before.active
          )
            throw new HandoffError("Choose your own active storage box.", 403);
          await lockInventoryDestinations(tx, [before.id]);
          const changed = await tx.inventoryLocation.updateMany({
            where: {
              id: before.id,
              ownerPlayerId: actor.playerId,
              capacityRevision: value.revision,
              kind: "NORMAL",
              systemManaged: false,
            },
            data: {
              isBulk: value.isBulk,
              capacityRevision: { increment: 1 },
              ...(before.type === "Bulk cleanup" && !value.isBulk
                ? { type: "Long box" }
                : {}),
            },
          });
          if (changed.count !== 1)
            throw new HandoffError(
              "This box changed. Refresh before changing its purpose.",
              409,
            );
          await tx.inventoryAuditLog.create({
            data: {
              changedByUserId: userId,
              changeType: "bulk_box_purpose_updated",
              beforeJson: { locationId: before.id, isBulk: before.isBulk },
              afterJson: { locationId: before.id, isBulk: value.isBulk },
            },
          });
          return {
            id: before.id,
            message: value.isBulk
              ? "Box marked as bulk. Cards remain in place."
              : "Box returned to normal storage.",
          };
        },
        { isolationLevel: "Serializable", timeout: 30000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}
