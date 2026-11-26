import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { locationIsBulk } from "./pull-scope";
import { readStorageLayout } from "./storage-layout";
import {
  bulkActionInput,
  bulkSettingsInput,
  BULK_BOX_TYPE,
  type BulkActionInput,
  type BulkResult,
} from "./bulk-cleanup-policy";
import {
  bulkOwner,
  bulkSettings,
  bulkStock,
  bulkScans,
  type BulkTx,
} from "./bulk-cleanup-service";
import { handoffHash, handoffStamp } from "./card-handoff-policy";
import { HandoffError, giveInventoryCardInTransaction } from "./card-handoffs";
import { lockDeckOwners } from "./deck-write-fence";
import {
  lockInventoryDestinations,
  lockAndReadInventoryCapacity,
} from "./inventory-capacity";
import { normalizeLocationName } from "./inventory-locations";
import { recordInventoryAudit } from "./inventory-audit";
import { writeInventoryReceipt } from "./inventory-receipt";
import { acquisitionIgnoreTransition } from "./acquisition-ignore";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const changed = () =>
  new HandoffError(
    "These copies or your cleanup settings changed. Refresh the pull list and check it again.",
  );
async function gate(tx: BulkTx, userId: string, requestId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ":" + requestId},251125))`;
}
async function receipt(
  tx: BulkTx,
  userId: string,
  ownerId: string,
  input: BulkActionInput,
  hash: string,
) {
  const prior = await tx.bulkCleanupAction.findUnique({
    where: {
      actorUserId_requestId: {
        actorUserId: userId,
        requestId: input.requestId,
      },
    },
  });
  if (!prior) return null;
  if (prior.ownerPlayerId !== ownerId || prior.requestHash !== hash)
    throw new HandoffError(
      "This confirmation belongs to another action or owner.",
    );
  return { ...(prior.resultJson as unknown as BulkResult), replay: true };
}
async function save(
  tx: BulkTx,
  userId: string,
  ownerId: string,
  input: BulkActionInput,
  hash: string,
  result: BulkResult,
) {
  await tx.bulkCleanupAction.create({
    data: {
      actorUserId: userId,
      ownerPlayerId: ownerId,
      requestId: input.requestId,
      requestHash: hash,
      action: input.action,
      resultJson: json(result),
    },
  });
  return result;
}
async function apply(
  tx: BulkTx,
  userId: string,
  input: BulkActionInput,
  hash: string,
): Promise<BulkResult> {
  await gate(tx, userId, input.requestId);
  const actor = await bulkOwner(tx, userId),
    previous = await receipt(tx, userId, actor.playerId, input, hash);
  if (previous) return previous;
  const settings = bulkSettings(actor);
  if (!settings.enabled || settings.stamp !== input.policyStamp)
    throw changed();
  await lockDeckOwners(tx, [userId]);
  let destination: string | undefined;
  if (input.action === "IGNORE_SCANS") {
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${input.batchId} AND "ownerPlayerId"=${actor.playerId} FOR UPDATE`;
  } else {
    const ids = input.selected.map((row) => row.id).sort();
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "InventoryItem" WHERE id IN (${Prisma.join(ids)}) AND "currentOwnerId"=${actor.playerId} ORDER BY id FOR UPDATE`,
    );
    const sources = await tx.inventoryItem.findMany({
      where: { id: { in: ids }, currentOwnerId: actor.playerId },
      select: { locationId: true },
    });
    const locations = [
      ...new Set(
        sources.flatMap((row) => (row.locationId ? [row.locationId] : [])),
      ),
    ].sort();
    for (let offset = 0; offset < locations.length; offset += 100)
      await lockInventoryDestinations(
        tx,
        locations.slice(offset, offset + 100),
      );
  }
  const planned =
    input.action === "IGNORE_SCANS"
      ? await bulkScans(tx, actor, input.batchId)
      : await bulkStock(
          tx,
          actor,
          [
            ...new Set(
              input.selected.map((row) => JSON.parse(row.group)[0] as string),
            ),
          ],
          input.scope,
        );
  const byId = new Map(planned.items.map((row) => [row.id, row]));
  const picked = input.selected.map((selection) => {
    const row = byId.get(selection.id);
    if (
      !row ||
      row.group !== selection.group ||
      row.groupStamp !== selection.groupStamp ||
      row.stamp !== selection.stamp ||
      selection.quantity > row.quantity
    )
      throw changed();
    return { ...row, quantity: selection.quantity };
  });
  // Quantities are bounded by each freshly allocated excess lot. A partial
  // selection can never spend the same group's allowance twice.
  const quantity = picked.reduce((sum, row) => sum + row.quantity, 0);
  if (input.action === "IGNORE_SCANS") {
    const batch = await tx.acquisitionSession.findUniqueOrThrow({
      where: { id: input.batchId },
      include: { run: true },
    });
    if (!batch.run) throw changed();
    if (batch.locationId)
      await lockInventoryDestinations(tx, [batch.locationId]);
    const photos = await tx.acquisitionPhoto.findMany({
      where: { id: { in: picked.map((row) => row.id) }, runId: batch.run.id },
      select: { id: true, slotId: true },
    });
    for (const photo of photos) {
      const candidate = await tx.acquisitionCandidate.findUniqueOrThrow({
        where: {
          runId_physicalId: { runId: batch.run.id, physicalId: photo.slotId },
        },
        include: { receipt: true },
      });
      const transition = acquisitionIgnoreTransition(
        candidate,
        "ignore",
        candidate.revision,
      );
      await tx.acquisitionCandidate.update({
        where: { id: candidate.id },
        data: transition,
      });
    }
    if (photos.length !== picked.length) throw changed();
    await tx.acquisitionSession.update({
      where: { id: batch.id },
      data: { revision: { increment: 1 } },
    });
    await tx.acquisitionCommand.create({
      data: {
        runId: batch.run.id,
        requestKey: `bulk-excess:${input.requestId}`,
        payload: JSON.stringify({
          version: 1,
          action: "BULK_EXCESS_IGNORE",
          actorId: userId,
          hash,
          pulled: picked,
        }),
      },
    });
  } else {
    let targetId: string | undefined;
    let targetSection: string | null = null;
    if (input.action === "MOVE") {
      // Serialize name creation with other cleanup requests; an ordinary box is
      // never silently relabeled or removed from the normal counting policy.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.playerId + ":bulk-box"},251126))`;
      const normalizedName = input.boxName
        ? normalizeLocationName(input.boxName)
        : "";
      let target = await tx.inventoryLocation.findFirst({
        where: {
          ownerPlayerId: actor.playerId,
          ...(input.destinationId
            ? { id: input.destinationId }
            : { normalizedName, parentLocationId: null }),
        },
      });
      if (!target && input.destinationId)
        throw new HandoffError(
          "Choose your own bulk storage destination.",
          403,
        );
      if (!target)
        target = await tx.inventoryLocation.create({
          data: {
            ownerPlayerId: actor.playerId,
            name: input.boxName!,
            normalizedName,
            type: BULK_BOX_TYPE,
            isBulk: true,
            storageLayout: { capacity: 1000, sections: [] },
            description:
              "Bulk/outgoing stock excluded from personal bulk cleanup counts.",
          },
        });
      const ownerLocations = await tx.inventoryLocation.findMany({
        where: { ownerPlayerId: actor.playerId },
      });
      const byLocation = new Map(ownerLocations.map((row) => [row.id, row]));
      let ancestor: typeof target | undefined = target;
      const seen = new Set<string>();
      while (ancestor) {
        if (
          seen.has(ancestor.id) ||
          !ancestor.active ||
          ancestor.kind !== "NORMAL" ||
          ancestor.systemManaged
        )
          throw new HandoffError("Destination unavailable.");
        seen.add(ancestor.id);
        if (!ancestor.parentLocationId) break;
        ancestor = byLocation.get(ancestor.parentLocationId);
        if (!ancestor) throw new HandoffError("Destination unavailable.");
      }
      if (
        !locationIsBulk(target.id, byLocation) ||
        !target.active ||
        target.kind !== "NORMAL" ||
        target.systemManaged
      )
        throw new HandoffError(
          "Choose a new box name or an existing bulk cleanup box. Ordinary boxes stay included in your collection limit.",
        );
      const capacity = await lockAndReadInventoryCapacity(tx, {
        locationId: target.id,
        ownerPlayerId: actor.playerId,
        section: input.destinationSection || null,
      });
      const layout = readStorageLayout(target.storageLayout, target.type);
      if (
        input.destinationSection &&
        !layout.sections.some((row) => row.name === input.destinationSection)
      )
        throw new HandoffError("Choose an existing destination section.");
      targetSection = input.destinationSection || null;
      if (capacity.remaining !== null && capacity.remaining < quantity)
        throw new HandoffError(
          "The bulk box does not have enough available space.",
        );
      targetId = target.id;
      destination = target.name;
    }
    for (const row of picked) {
      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (input.action === "GIVE") {
        const handoff = await giveInventoryCardInTransaction(
          tx,
          { userId, adminMode: false },
          {
            requestId: randomUUID(),
            inventoryItemId: item.id,
            expectedStamp: handoffStamp(item),
            quantity: row.quantity,
            kind: input.kind,
            recipient: input.recipient,
          },
        );
        destination = handoff.recipientName;
      } else {
        const after = await tx.inventoryItem.update({
          where: { id: item.id },
          data: { quantity: { decrement: row.quantity } },
        });
        await recordInventoryAudit({
          tx,
          action:
            input.action === "MOVE"
              ? "bulk_cleanup_moved"
              : "bulk_cleanup_removed",
          actingUserId: userId,
          inventoryItemId: item.id,
          before: json(item),
          after: json(after),
          reason: "Confirmed physically pulled excess copies",
          metadata: { requestId: input.requestId },
        });
        if (targetId)
          await writeInventoryReceipt(tx, {
            lot: {
              currentOwnerId: item.currentOwnerId,
              originalOpenerId: item.originalOpenerId,
              cardId: item.cardId,
              quantity: row.quantity,
              foilStatus: item.foilStatus,
              sourceType: item.sourceType,
              condition: item.condition,
              language: item.language,
              acquiredFromPullId: item.acquiredFromPullId,
              roundId: item.roundId,
              notes: item.notes,
              locationId: targetId,
              locationSection: targetSection,
            },
            merge: null,
            audit: {
              action: "bulk_cleanup_received",
              actingUserId: userId,
              reason: "Moved excess to bulk/outgoing storage",
              metadata: {
                requestId: input.requestId,
                sourceInventoryItemId: item.id,
              },
            },
          });
      }
    }
  }
  const verb =
    input.action === "IGNORE_SCANS"
      ? "Ignored"
      : input.action === "REMOVE"
        ? "Removed"
        : input.action === "MOVE"
          ? "Moved"
          : input.kind === "TRADE"
            ? "Traded"
            : "Gave";
  return save(tx, userId, actor.playerId, input, hash, {
    requestId: input.requestId,
    action: input.action,
    status: "APPLIED",
    quantity,
    items: picked.map(
      ({ name, setCode, collectorNumber, quantity, finish, language }) => ({
        name,
        setCode,
        collectorNumber,
        quantity,
        finish,
        language,
      }),
    ),
    destination,
    message: `${verb} ${quantity} ${quantity === 1 ? "copy" : "copies"}${destination ? ` to ${destination}` : ""}.`,
  });
}
export async function performBulkAction(
  db: PrismaClient,
  userId: string,
  raw: unknown,
): Promise<BulkResult> {
  const input = bulkActionInput.parse(raw),
    hash = handoffHash(input);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction((tx) => apply(tx, userId, input, hash), {
        isolationLevel: "Serializable",
        timeout: 60000,
        maxWait: 10000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        attempt < 3 &&
        (error.code === "P2034" ||
          error.code === "P2002" ||
          (error.code === "P2010" &&
            ["40001", "40P01"].includes(String(error.meta?.code))))
      )
        continue;
      if (
        !(error instanceof HandoffError) ||
        error.status === 401 ||
        error.status === 403
      )
        throw error;
      // Close known rejections under the same request gate, recovering an
      // earlier success first. A late response cannot apply a canceled intent.
      return db.$transaction(
        async (tx) => {
          await gate(tx, userId, input.requestId);
          const actor = await bulkOwner(tx, userId),
            previous = await receipt(tx, userId, actor.playerId, input, hash);
          return (
            previous ??
            save(tx, userId, actor.playerId, input, hash, {
              requestId: input.requestId,
              action: input.action,
              status: "REJECTED",
              quantity: 0,
              items: [],
              message: error.message,
            })
          );
        },
        { timeout: 20000 },
      );
    }
  }
}
export async function saveBulkSettings(
  db: PrismaClient,
  userId: string,
  raw: unknown,
) {
  const input = bulkSettingsInput.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const actor = await bulkOwner(tx, userId);
    const result = await tx.user.updateMany({
      where: { id: userId, bulkCleanupRevision: input.revision },
      data: {
        bulkCleanupEnabled: input.enabled,
        bulkCleanupMaxCopies: input.maxCopies,
        bulkCleanupIncludeDecks: input.includeDecks,
        bulkCleanupRevision: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new HandoffError(
        "Your settings changed in another tab. Reload Settings before saving.",
      );
    await tx.inventoryAuditLog.create({
      data: {
        changedByUserId: userId,
        changeType: "bulk_cleanup_settings_updated",
        beforeJson: json(bulkSettings(actor)),
        afterJson: {
          enabled: input.enabled,
          maxCopies: input.maxCopies,
          includeDecks: input.includeDecks,
        },
      },
    });
    return bulkSettings(await bulkOwner(tx, userId));
  });
}
