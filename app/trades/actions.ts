"use server";

import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import {
  InventoryLocationKind,
  InventorySourceType,
  TradeStatus,
  TradeWishlistStatus,
} from "@prisma/client";
import { ensureDefaultLocation } from "@/lib/inventory-locations";
import { revalidatePath } from "next/cache";
import {
  assertCanAcceptTrade,
  assertCanCancelTrade,
  assertCanDeclineTrade,
  isTerminalTradeStatus,
} from "@/lib/trade-policy";

const activeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];
const physicalStatuses: TradeStatus[] = [
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

type ProposedTradeData = {
  proposerPlayerId: string;
  receiverPlayerId: string;
  offeredInventoryItemId: string;
  requestedInventoryItemId: string;
};
type InventoryForSnapshot = Awaited<
  ReturnType<typeof validateProposedTrade>
>["offered"];

function inventorySnapshot(item: InventoryForSnapshot) {
  return {
    id: item.id,
    cardId: item.cardId,
    cardName: item.card.name,
    setCode: item.card.setCode,
    collectorNumber: item.card.collectorNumber,
    imageUri: item.card.imageUri,
    imageUris: item.card.imageUris,
    quantity: item.quantity,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    sourceType: item.sourceType,
    notes: item.notes,
    currentOwnerId: item.currentOwnerId,
    currentOwnerName: item.currentOwner.displayName,
  };
}

async function validateProposedTrade(data: ProposedTradeData) {
  if (data.proposerPlayerId === data.receiverPlayerId)
    throw new Error("Proposer and recipient must be different users.");
  if (data.offeredInventoryItemId === data.requestedInventoryItemId)
    throw new Error("Trades must be exactly one card for one card.");
  const [offered, requested] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id: data.offeredInventoryItemId },
      include: {
        currentOwner: true,
        card: true,
        location: true,
      },
    }),
    prisma.inventoryItem.findUnique({
      where: { id: data.requestedInventoryItemId },
      include: {
        currentOwner: true,
        card: true,
        location: true,
      },
    }),
  ]);
  if (!offered || offered.currentOwnerId !== data.proposerPlayerId)
    throw new Error("You can only offer cards from your own inventory.");
  if (!requested || requested.currentOwnerId !== data.receiverPlayerId)
    throw new Error(
      "You can only request cards from the selected trade partner.",
    );
  if (offered.quantity < 1 || requested.quantity < 1)
    throw new Error("Both selected cards must have available quantity.");
  if (
    offered.location?.kind === InventoryLocationKind.DECK ||
    requested.location?.kind === InventoryLocationKind.DECK
  ) {
    throw new Error(
      "Cards committed to decks are excluded from normal trade availability. Return them to inventory first.",
    );
  }
  const reservationRows = await prisma.trade.findMany({
    where: {
      status: { in: activeStatuses },
      OR: [
        { offeredInventoryItemId: { in: [offered.id, requested.id] } },
        { requestedInventoryItemId: { in: [offered.id, requested.id] } },
      ],
    },
    select: { offeredInventoryItemId: true, requestedInventoryItemId: true },
  });
  const reservationCount = (id: string) =>
    reservationRows.filter(
      (t) =>
        t.offeredInventoryItemId === id || t.requestedInventoryItemId === id,
    ).length;
  if (
    offered.quantity - reservationCount(offered.id) < 1 ||
    requested.quantity - reservationCount(requested.id) < 1
  )
    throw new Error("That card is already reserved in another active trade.");
  return { offered, requested };
}

async function loadTradeForAction(tradeId: string) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      proposerPlayer: true,
      receiverPlayer: true,
      offeredInventoryItem: {
        include: {
          card: true,
          currentOwner: true,
          auditLogs: true,
        },
      },
      requestedInventoryItem: {
        include: {
          card: true,
          currentOwner: true,
          auditLogs: true,
        },
      },
    },
  });
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

export async function createTrade(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const proposerPlayerId = actorIsAdmin
    ? String(fd.get("proposerPlayerId") || "")
    : actor.playerId!;
  if (!actorIsAdmin && proposerPlayerId !== actor.playerId)
    throw new Error("Users cannot propose trades for another user.");
  const data = {
    proposerPlayerId,
    receiverPlayerId: String(fd.get("receiverPlayerId") || ""),
    offeredInventoryItemId: String(fd.get("offeredInventoryItemId") || ""),
    requestedInventoryItemId: String(fd.get("requestedInventoryItemId") || ""),
  };
  const { offered, requested } = await validateProposedTrade(data);
  await prisma.trade.create({
    data: {
      ...data,
      offeredSnapshotJson: inventorySnapshot(offered),
      requestedSnapshotJson: inventorySnapshot(requested),
      status: TradeStatus.PROPOSED,
      message: String(fd.get("message") || "") || null,
      createdByUserId: actor.id,
      events: {
        create: {
          eventType: "proposed",
          actorUserId: actor.id,
          actorPlayerId: actor.playerId,
          message: "Trade proposed.",
        },
      },
    },
  });
  revalidatePath("/trades");
}

export async function cancelTradeWishlistItem(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const tradeWishlistItemId = String(fd.get("tradeWishlistItemId") || "");
  const item = await prisma.tradeWishlistItem.findUnique({
    where: { id: tradeWishlistItemId },
    select: { id: true, ownerUserId: true },
  });
  if (!item) throw new Error("Trade wishlist item not found.");
  if (!actorIsAdmin && item.ownerUserId !== actor.id)
    throw new Error("You can only cancel your own trade wishlist cards.");
  await prisma.tradeWishlistItem.update({
    where: { id: item.id },
    data: { status: TradeWishlistStatus.CANCELLED },
  });
  revalidatePath("/trades");
  revalidatePath("/wishlist");
}

export async function actOnTrade(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const tradeId = String(fd.get("tradeId") || "");
  const action = String(fd.get("action") || "");
  const trade = await loadTradeForAction(tradeId);
  if (
    !actorIsAdmin &&
    actor.playerId !== trade.proposerPlayerId &&
    actor.playerId !== trade.receiverPlayerId
  )
    throw new Error("You cannot act on another user's trade.");
  const now = new Date();
  if (action === "accept") {
    assertCanAcceptTrade({
      actorOwnerId: actor.playerId,
      isAdmin: actorIsAdmin,
      proposerOwnerId: trade.proposerPlayerId,
      recipientOwnerId: trade.receiverPlayerId,
      status: trade.status,
    });
    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: TradeStatus.ACCEPTED_PENDING_EXCHANGE,
        acceptedAt: now,
        events: {
          create: {
            eventType: "accepted",
            actorUserId: actor.id,
            actorPlayerId: actor.playerId,
            message: "Trade accepted; awaiting physical exchange.",
          },
        },
      },
    });
  } else if (action === "decline") {
    assertCanDeclineTrade({
      actorOwnerId: actor.playerId,
      isAdmin: actorIsAdmin,
      proposerOwnerId: trade.proposerPlayerId,
      recipientOwnerId: trade.receiverPlayerId,
      status: trade.status,
    });
    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: TradeStatus.DECLINED,
        declinedAt: now,
        events: {
          create: {
            eventType: "declined",
            actorUserId: actor.id,
            actorPlayerId: actor.playerId,
            message: String(fd.get("reason") || "Trade declined."),
          },
        },
      },
    });
  } else if (action === "cancel") {
    assertCanCancelTrade({
      actorOwnerId: actor.playerId,
      isAdmin: actorIsAdmin,
      proposerOwnerId: trade.proposerPlayerId,
      recipientOwnerId: trade.receiverPlayerId,
      status: trade.status,
    });
    const reason = String(fd.get("reason") || "Trade cancelled.");
    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: TradeStatus.CANCELLED,
        cancelledAt: now,
        events: {
          create: {
            eventType:
              actorIsAdmin && actor.playerId !== trade.proposerPlayerId
                ? "admin_cancelled"
                : "cancelled",
            actorUserId: actor.id,
            actorPlayerId: actor.playerId,
            message: reason,
          },
        },
      },
    });
  } else {
    throw new Error("Unknown trade action.");
  }
  revalidatePath("/trades");
}

async function removeFromSource(
  tx: any,
  tradeId: string,
  item: NonNullable<
    Awaited<ReturnType<typeof loadTradeForAction>>["offeredInventoryItem"]
  >,
  actorUserId: string,
  reason: string,
) {
  const beforeJson = {
    ...item,
    previousOwnerId: item.currentOwnerId,
    quantityTransferred: 1,
  } as any;
  if (item.quantity > 1) {
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { decrement: 1 } },
    });
    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: actorUserId,
        tradeId,
        changeType: "trade_completed",
        beforeJson,
        afterJson: {
          ...updated,
          previousOwnerId: item.currentOwnerId,
          newOwnerId: item.currentOwnerId,
          quantityTransferred: 1,
        } as any,
        reason,
      },
    });
    return;
  }
  await tx.inventoryAuditLog.create({
    data: {
      inventoryItemId: item.id,
      changedByUserId: actorUserId,
      tradeId,
      changeType: "trade_completed",
      beforeJson,
      afterJson: {
        ...beforeJson,
        quantity: 0,
        deleted: true,
        previousOwnerId: item.currentOwnerId,
        newOwnerId: null,
        quantityTransferred: 1,
      },
      reason,
    },
  });
  await tx.inventoryItem.delete({ where: { id: item.id } });
}

async function addToReceiver(
  tx: any,
  tradeId: string,
  item: NonNullable<
    Awaited<ReturnType<typeof loadTradeForAction>>["offeredInventoryItem"]
  >,
  toPlayerId: string,
  actorUserId: string,
  reason: string,
) {
  const destinationLocation = await ensureDefaultLocation(tx, toPlayerId);
  const existing = await tx.inventoryItem.findFirst({
    where: {
      currentOwnerId: toPlayerId,
      cardId: item.cardId,
      foil: item.foil,
      foilStatus: item.foilStatus,
      condition: item.condition,
      language: item.language,
      locationId: destinationLocation.id,
      quantity: { gt: 0 },
    },
  });
  if (existing) {
    const beforeJson = {
      ...existing,
      previousOwnerId: item.currentOwnerId,
      newOwnerId: toPlayerId,
      quantityTransferred: 1,
    } as any;
    const updated = await tx.inventoryItem.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: 1 },
        sourceType: InventorySourceType.TRADE,
      },
    });
    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: actorUserId,
        tradeId,
        changeType: "trade_completed",
        beforeJson,
        afterJson: {
          ...updated,
          previousOwnerId: item.currentOwnerId,
          newOwnerId: toPlayerId,
          quantityTransferred: 1,
        } as any,
        reason,
      },
    });
  } else {
    const created = await tx.inventoryItem.create({
      data: {
        currentOwnerId: toPlayerId,
        originalOpenerId: toPlayerId,
        cardId: item.cardId,
        quantity: 1,
        foil: item.foil,
        foilStatus: item.foilStatus,
        sourceType: InventorySourceType.TRADE,
        condition: item.condition,
        language: item.language,
        roundId: null,
        locationId: destinationLocation.id,
        notes: item.notes,
      },
    });
    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: created.id,
        changedByUserId: actorUserId,
        tradeId,
        changeType: "trade_completed",
        beforeJson: {
          previousOwnerId: item.currentOwnerId,
          newOwnerId: toPlayerId,
          quantityTransferred: 1,
        },
        afterJson: {
          ...created,
          previousOwnerId: item.currentOwnerId,
          newOwnerId: toPlayerId,
          quantityTransferred: 1,
        } as any,
        reason,
      },
    });
  }
}

async function completeTradeIfReady(
  tradeId: string,
  actorUserId: string,
  force = false,
) {
  const trade = await loadTradeForAction(tradeId);
  if (isTerminalTradeStatus(trade.status)) return;
  if (!force && (!trade.proposerCommittedAt || !trade.receiverCommittedAt))
    return;
  if (!trade.offeredInventoryItem || !trade.requestedInventoryItem)
    throw new Error("One of the traded cards is no longer available.");
  const reason = `Completed trade between ${trade.proposerPlayer.displayName} and ${trade.receiverPlayer.displayName}`;
  await prisma.$transaction(async (tx) => {
    const offered = await tx.inventoryItem.findUnique({
      where: { id: trade.offeredInventoryItem!.id },
      include: {
        card: true,
        currentOwner: true,
        auditLogs: true,
      },
    });
    const requested = await tx.inventoryItem.findUnique({
      where: { id: trade.requestedInventoryItem!.id },
      include: {
        card: true,
        currentOwner: true,
        auditLogs: true,
      },
    });
    const currentTrade = await tx.trade.findUnique({
      where: { id: tradeId },
      select: { status: true },
    });
    if (!currentTrade || isTerminalTradeStatus(currentTrade.status)) return;
    if (
      !offered ||
      !requested ||
      offered.quantity < 1 ||
      requested.quantity < 1
    )
      throw new Error("One of the traded cards is no longer available.");
    if (
      offered.currentOwnerId !== trade.proposerPlayerId ||
      requested.currentOwnerId !== trade.receiverPlayerId
    )
      throw new Error("Trade inventory ownership changed before completion.");
    await removeFromSource(tx, tradeId, offered as any, actorUserId, reason);
    await removeFromSource(tx, tradeId, requested as any, actorUserId, reason);
    await addToReceiver(
      tx,
      tradeId,
      offered as any,
      trade.receiverPlayerId,
      actorUserId,
      reason,
    );
    await addToReceiver(
      tx,
      tradeId,
      requested as any,
      trade.proposerPlayerId,
      actorUserId,
      reason,
    );
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.COMPLETED,
        completedAt: new Date(),
        proposerCommittedAt: trade.proposerCommittedAt ?? new Date(),
        receiverCommittedAt: trade.receiverCommittedAt ?? new Date(),
        events: {
          create: { eventType: "completed", actorUserId, message: reason },
        },
      },
    });
  });
}

export async function confirmPhysicalTrade(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const trade = await loadTradeForAction(String(fd.get("tradeId") || ""));
  if (!physicalStatuses.includes(trade.status))
    throw new Error("This trade is not awaiting physical confirmation.");
  const data: any = { status: TradeStatus.PARTIALLY_COMMITTED };
  let eventType = "physical_confirmed";
  if (actorIsAdmin && fd.get("forceComplete")) {
    const reason = String(fd.get("reason") || "");
    if (!reason) throw new Error("Admin force complete requires a reason.");
    await prisma.tradeEvent.create({
      data: {
        tradeId: trade.id,
        eventType: "admin_force_complete",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: reason,
      },
    });
    await completeTradeIfReady(trade.id, actor.id, true);
    revalidatePath("/trades");
    return;
  }
  if (actor.playerId === trade.proposerPlayerId) {
    if (trade.proposerCommittedAt)
      throw new Error("You have already confirmed this physical exchange.");
    data.proposerCommittedAt = new Date();
    eventType = "proposer_confirmed_physical_exchange";
  } else if (actor.playerId === trade.receiverPlayerId) {
    if (trade.receiverCommittedAt)
      throw new Error("You have already confirmed this physical exchange.");
    data.receiverCommittedAt = new Date();
    eventType = "receiver_confirmed_physical_exchange";
  } else {
    throw new Error(
      "Only trade participants can confirm the physical exchange.",
    );
  }
  await prisma.trade.update({
    where: { id: trade.id },
    data: {
      ...data,
      events: {
        create: {
          eventType,
          actorUserId: actor.id,
          actorPlayerId: actor.playerId,
          message: "Physical exchange confirmed.",
        },
      },
    },
  });
  await completeTradeIfReady(trade.id, actor.id);
  revalidatePath("/trades");
}
