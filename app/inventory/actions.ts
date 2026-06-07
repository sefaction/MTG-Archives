"use server";

import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TradeStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

const activeTradeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

async function assertNotReserved(inventoryItemId: string) {
  const activeTrade = await prisma.trade.findFirst({
    where: {
      status: { in: activeTradeStatuses },
      OR: [
        { offeredInventoryItemId: inventoryItemId },
        { requestedInventoryItemId: inventoryItemId },
      ],
    },
    select: { id: true, status: true },
  });
  if (activeTrade)
    throw new Error(
      "This inventory item is reserved in an active trade and cannot be deleted.",
    );
}

export async function deleteInventoryItem(fd: FormData) {
  const actionUser = await requireLogin();
  const actionScope = await getAccessScope(actionUser);
  const actionIsAdmin = actionScope?.mode === "admin";
  const inventoryItemId = String(fd.get("inventoryItemId") || "");
  const reason = String(
    fd.get("deleteReason") || fd.get("reason") || "",
  ).trim();
  if (!inventoryItemId) throw new Error("Missing inventory item id.");
  if (!reason) throw new Error("A delete reason is required.");
  await assertNotReserved(inventoryItemId);
  const item = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    include: {
      card: true,
      currentOwner: true,
    },
  });
  if (!item) throw new Error("Inventory item not found.");
  if (!actionIsAdmin) {
    if (!actionUser.playerId) {
      throw new Error("Your account is not linked to an inventory owner.");
    }
    if (item.currentOwnerId !== actionUser.playerId) {
      throw new Error("You can only delete inventory you own.");
    }
  }
  const beforeJson = { ...item } as any;
  await prisma.$transaction(async (tx) => {
    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: item.id,
        changedByUserId: actionUser.id,
        changeType: actionIsAdmin
          ? "admin_delete_inventory"
          : "user_delete_inventory",
        reason,
        beforeJson,
        afterJson: { ...beforeJson, deleted: true },
      },
    });
    await tx.inventoryItem.delete({ where: { id: item.id } });
  });
  revalidatePath("/inventory");
}

export async function cleanupZeroQuantityInventory(fd?: FormData) {
  const admin = await requireLogin();
  const adminScope = await getAccessScope(admin);
  if (adminScope?.mode !== "admin") throw new Error("Admin mode is required.");
  const reason = String(
    fd?.get("reason") || "Admin cleanup of zero-quantity inventory items.",
  );
  const activeTrades = await prisma.trade.findMany({
    where: { status: { in: activeTradeStatuses } },
    select: { offeredInventoryItemId: true, requestedInventoryItemId: true },
  });
  const reserved = new Set(
    activeTrades
      .flatMap((trade) => [
        trade.offeredInventoryItemId,
        trade.requestedInventoryItemId,
      ])
      .filter((id): id is string => Boolean(id)),
  );
  const zeroItems = await prisma.inventoryItem.findMany({
    where: { quantity: { lte: 0 }, id: { notIn: [...reserved] } },
    include: {
      card: true,
      currentOwner: true,
    },
  });
  await prisma.$transaction(async (tx) => {
    for (const item of zeroItems) {
      const beforeJson = { ...item } as any;
      await tx.inventoryAuditLog.create({
        data: {
          inventoryItemId: item.id,
          changedByUserId: admin.id,
          changeType: "admin_cleanup_zero_quantity",
          reason,
          beforeJson,
          afterJson: { ...beforeJson, deleted: true },
        },
      });
      await tx.inventoryItem.delete({ where: { id: item.id } });
    }
  });
  revalidatePath("/inventory");
}
