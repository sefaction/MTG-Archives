"use server";

import { revalidatePath } from "next/cache";
import { TradeWishlistStatus } from "@prisma/client";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPublicInventoryWhere } from "@/lib/public-collection";
import { recordTradeWishlistNotificationActivity } from "@/lib/wishlist-notification-digests";

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

function positiveQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 999) : 1;
}

export async function addPublicInventoryToTradeWishlist(fd: FormData) {
  const user = await requireLogin();
  if (!user.playerId)
    throw new Error("Your account is not linked to an inventory owner.");

  const inventoryItemId = formString(fd, "inventoryItemId");
  if (!inventoryItemId) throw new Error("Select a public inventory item.");

  const item = await prisma.inventoryItem.findFirst({
    where: {
      ...buildPublicInventoryWhere({}),
      id: inventoryItemId,
      quantity: { gt: 0 },
    },
    include: {
      card: true,
      currentOwner: true,
    },
  });
  if (!item) throw new Error("That public inventory item is not available.");
  if (item.currentOwnerId === user.playerId)
    throw new Error("You cannot trade-wishlist your own card.");

  const quantity = positiveQuantity(fd.get("quantity"));
  const notes = formString(fd, "notes") || null;
  await prisma.$transaction(async (tx) => {
    const wishlistItem = await tx.tradeWishlistItem.upsert({
      where: {
        ownerUserId_targetOwnerPlayerId_cardId: {
          ownerUserId: user.id,
          targetOwnerPlayerId: item.currentOwnerId,
          cardId: item.cardId,
        },
      },
      create: {
        ownerUserId: user.id,
        targetOwnerPlayerId: item.currentOwnerId,
        targetInventoryItemId: item.id,
        cardId: item.cardId,
        quantity,
        notes,
        status: TradeWishlistStatus.OPEN,
      },
      update: {
        quantity: { increment: quantity },
        targetInventoryItemId: item.id,
        notes,
        status: TradeWishlistStatus.OPEN,
      },
    });
    await recordTradeWishlistNotificationActivity(tx, {
      actorUserId: user.id,
      targetOwnerPlayerId: item.currentOwnerId,
      tradeWishlistItemId: wishlistItem.id,
      cardName: item.card.name,
      quantityAdded: quantity,
    });
  });

  console.info("trade_wishlist_item_added_from_public_inventory", {
    ownerUserId: user.id,
    targetOwnerPlayerId: item.currentOwnerId,
    inventoryItemId: item.id,
    cardId: item.cardId,
    quantity,
  });
  revalidatePath("/wishlist");
  revalidatePath("/trades");
  revalidatePath("/public/inventory");
}
