"use server";

import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import {
  InventoryLocationKind,
  InventorySourceType,
  TradeLineSide,
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
import { fulfillCompletedTradeWishlists } from "@/lib/trade-wishlist";
import {
  buildReservedInventoryQuantities,
  parseTradeLineSelections,
  type TradeLineSelection,
} from "@/lib/trade-lines";
import { selectTradeCardPrice } from "@/lib/trade-value";

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
  offeredLines: TradeLineSelection[];
  requestedLines: TradeLineSelection[];
};
type InventoryForSnapshot = Awaited<
  ReturnType<typeof validateProposedTrade>
>["offered"][number]["item"];

function inventorySnapshot(
  item: InventoryForSnapshot,
  quantity: number,
  preferredPriceProvider?: string | null,
) {
  const price = selectTradeCardPrice(
    item.card.prices,
    item.foilStatus,
    preferredPriceProvider,
  );
  return {
    id: item.id,
    cardId: item.cardId,
    cardName: item.card.name,
    setCode: item.card.setCode,
    collectorNumber: item.card.collectorNumber,
    imageUri: item.card.imageUri,
    imageUris: item.card.imageUris,
    quantity: item.quantity,
    tradeQuantity: quantity,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    sourceType: item.sourceType,
    notes: item.notes,
    currentOwnerId: item.currentOwnerId,
    currentOwnerName: item.currentOwner.displayName,
    priceAmount: price.amount,
    priceLabel: price.label,
    priceProvider: price.provider,
  };
}

async function validateProposedTrade(data: ProposedTradeData) {
  if (data.proposerPlayerId === data.receiverPlayerId)
    throw new Error("Proposer and recipient must be different users.");
  if (!data.offeredLines.length || !data.requestedLines.length) {
    throw new Error("Choose at least one card on each side of the trade.");
  }
  const selections = [...data.offeredLines, ...data.requestedLines];
  const itemIds = Array.from(
    new Set(selections.map((line) => line.inventoryItemId)),
  );
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    include: { currentOwner: true, card: true, location: true },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const resolveLines = (
    lines: TradeLineSelection[],
    expectedOwnerId: string,
    ownershipError: string,
  ) =>
    lines.map((line) => {
      const item = itemById.get(line.inventoryItemId);
      if (!item || item.currentOwnerId !== expectedOwnerId) {
        throw new Error(ownershipError);
      }
      if (item.location?.kind === InventoryLocationKind.DECK) {
        throw new Error(
          "Cards committed to decks are excluded from normal trade availability. Return them to inventory first.",
        );
      }
      return { item, quantity: line.quantity };
    });
  const offered = resolveLines(
    data.offeredLines,
    data.proposerPlayerId,
    "You can only offer cards from your own inventory.",
  );
  const requested = resolveLines(
    data.requestedLines,
    data.receiverPlayerId,
    "You can only request cards from the selected trade partner.",
  );
  const [reservationLines, legacyReservations] = await Promise.all([
    prisma.tradeLine.findMany({
      where: {
        inventoryItemId: { in: itemIds },
        trade: { status: { in: activeStatuses } },
      },
      select: { inventoryItemId: true, quantity: true },
    }),
    prisma.trade.findMany({
      where: {
        status: { in: activeStatuses },
        lines: { none: {} },
        OR: [
          { offeredInventoryItemId: { in: itemIds } },
          { requestedInventoryItemId: { in: itemIds } },
        ],
      },
      select: {
        offeredInventoryItemId: true,
        requestedInventoryItemId: true,
      },
    }),
  ]);
  const reserved = buildReservedInventoryQuantities(
    reservationLines,
    legacyReservations,
  );
  for (const line of [...offered, ...requested]) {
    if (
      line.item.quantity - (reserved.get(line.item.id) ?? 0) <
      line.quantity
    ) {
      throw new Error(
        "One or more selected quantities are already reserved or unavailable.",
      );
    }
  }
  return { offered, requested };
}

function tradeLinesFromForm(fd: FormData) {
  const legacyOfferedId = String(fd.get("offeredInventoryItemId") || "");
  const legacyRequestedId = String(fd.get("requestedInventoryItemId") || "");
  return {
    offeredLines: parseTradeLineSelections(
      fd.get("offeredLinesJson"),
      legacyOfferedId || undefined,
    ),
    requestedLines: parseTradeLineSelections(
      fd.get("requestedLinesJson"),
      legacyRequestedId || undefined,
    ),
  };
}

async function loadTradeForAction(tradeId: string) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      proposerPlayer: true,
      receiverPlayer: true,
      lines: {
        orderBy: [{ side: "asc" }, { position: "asc" }],
        include: {
          inventoryItem: {
            include: {
              card: true,
              currentOwner: true,
              auditLogs: true,
            },
          },
        },
      },
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
  const lineSelections = tradeLinesFromForm(fd);
  const data = {
    proposerPlayerId,
    receiverPlayerId: String(fd.get("receiverPlayerId") || ""),
    ...lineSelections,
  };
  const { offered, requested } = await validateProposedTrade(data);
  await prisma.trade.create({
    data: {
      proposerPlayerId: data.proposerPlayerId,
      receiverPlayerId: data.receiverPlayerId,
      status: TradeStatus.PROPOSED,
      message: String(fd.get("message") || "") || null,
      createdByUserId: actor.id,
      lines: {
        create: [
          ...offered.map((line, position) => ({
            side: TradeLineSide.PROPOSER,
            inventoryItemId: line.item.id,
            quantity: line.quantity,
            position,
            snapshotJson: inventorySnapshot(
              line.item,
              line.quantity,
              actor.preferredPriceProvider,
            ),
          })),
          ...requested.map((line, position) => ({
            side: TradeLineSide.RECEIVER,
            inventoryItemId: line.item.id,
            quantity: line.quantity,
            position,
            snapshotJson: inventorySnapshot(
              line.item,
              line.quantity,
              actor.preferredPriceProvider,
            ),
          })),
        ],
      },
      events: {
        create: {
          eventType: "proposed",
          actorUserId: actor.id,
          actorPlayerId: actor.playerId,
          message: `Trade proposed with ${offered.length} offered and ${requested.length} requested card lines.`,
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
  quantity: number,
  actorUserId: string,
  reason: string,
) {
  const beforeJson = {
    ...item,
    previousOwnerId: item.currentOwnerId,
    quantityTransferred: quantity,
  } as any;
  if (item.quantity > quantity) {
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { decrement: quantity } },
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
          quantityTransferred: quantity,
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
        quantityTransferred: quantity,
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
  quantity: number,
  toPlayerId: string,
  destinationLocationId: string | null | undefined,
  actorUserId: string,
  reason: string,
) {
  const destinationLocation = destinationLocationId
    ? await tx.inventoryLocation.findFirst({
        where: {
          id: destinationLocationId,
          ownerPlayerId: toPlayerId,
          active: true,
          kind: InventoryLocationKind.NORMAL,
          systemManaged: false,
        },
      })
    : await ensureDefaultLocation(tx, toPlayerId);
  if (!destinationLocation) {
    throw new Error("Selected trade destination location is not available.");
  }
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
      quantityTransferred: quantity,
    } as any;
    const updated = await tx.inventoryItem.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: quantity },
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
          quantityTransferred: quantity,
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
        quantity,
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
          quantityTransferred: quantity,
        },
        afterJson: {
          ...created,
          previousOwnerId: item.currentOwnerId,
          newOwnerId: toPlayerId,
          quantityTransferred: quantity,
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
  const lines = trade.lines.length
    ? trade.lines.map((line) => ({
        side: line.side,
        inventoryItem: line.inventoryItem,
        quantity: line.quantity,
      }))
    : [
        {
          side: TradeLineSide.PROPOSER,
          inventoryItem: trade.offeredInventoryItem,
          quantity: 1,
        },
        {
          side: TradeLineSide.RECEIVER,
          inventoryItem: trade.requestedInventoryItem,
          quantity: 1,
        },
      ];
  if (
    !lines.length ||
    lines.some((line) => !line.inventoryItem || line.quantity < 1)
  ) {
    throw new Error("One or more traded cards are no longer available.");
  }
  const reason = `Completed trade between ${trade.proposerPlayer.displayName} and ${trade.receiverPlayer.displayName}`;
  await prisma.$transaction(async (tx) => {
    const itemIds = lines.map((line) => line.inventoryItem!.id);
    const currentItems = await tx.inventoryItem.findMany({
      where: { id: { in: itemIds } },
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
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const resolvedLines = lines.map((line) => {
      const item = currentById.get(line.inventoryItem!.id);
      const expectedOwnerId =
        line.side === TradeLineSide.PROPOSER
          ? trade.proposerPlayerId
          : trade.receiverPlayerId;
      if (!item || item.quantity < line.quantity) {
        throw new Error("One or more traded cards are no longer available.");
      }
      if (item.currentOwnerId !== expectedOwnerId) {
        throw new Error("Trade inventory ownership changed before completion.");
      }
      return { ...line, inventoryItem: item };
    });
    for (const line of resolvedLines) {
      await removeFromSource(
        tx,
        tradeId,
        line.inventoryItem as any,
        line.quantity,
        actorUserId,
        reason,
      );
    }
    for (const line of resolvedLines) {
      const proposerSide = line.side === TradeLineSide.PROPOSER;
      await addToReceiver(
        tx,
        tradeId,
        line.inventoryItem as any,
        line.quantity,
        proposerSide ? trade.receiverPlayerId : trade.proposerPlayerId,
        proposerSide
          ? trade.receiverDestinationLocationId
          : trade.proposerDestinationLocationId,
        actorUserId,
        reason,
      );
    }
    await fulfillCompletedTradeWishlists(tx, {
      proposerPlayerId: trade.proposerPlayerId,
      receiverPlayerId: trade.receiverPlayerId,
      offeredCards: resolvedLines
        .filter((line) => line.side === TradeLineSide.PROPOSER)
        .map((line) => ({
          cardId: line.inventoryItem.cardId,
          quantity: line.quantity,
        })),
      requestedCards: resolvedLines
        .filter((line) => line.side === TradeLineSide.RECEIVER)
        .map((line) => ({
          cardId: line.inventoryItem.cardId,
          quantity: line.quantity,
        })),
    });
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

async function assertTradeDestinationLocation(
  locationId: string,
  ownerPlayerId: string,
) {
  const location = await prisma.inventoryLocation.findFirst({
    where: {
      id: locationId,
      ownerPlayerId,
      active: true,
      kind: InventoryLocationKind.NORMAL,
      systemManaged: false,
    },
    select: { id: true },
  });
  if (!location) {
    throw new Error("Choose an active normal location for the incoming card.");
  }
}

export async function confirmPhysicalTrade(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const trade = await loadTradeForAction(String(fd.get("tradeId") || ""));
  if (!physicalStatuses.includes(trade.status))
    throw new Error("This trade is not awaiting physical confirmation.");
  const data: any = { status: TradeStatus.PARTIALLY_COMMITTED };
  const destinationLocationId = String(fd.get("destinationLocationId") || "");
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
    revalidatePath("/wishlist");
    return;
  }
  if (actor.playerId === trade.proposerPlayerId) {
    if (trade.proposerCommittedAt)
      throw new Error("You have already confirmed this physical exchange.");
    if (destinationLocationId) {
      await assertTradeDestinationLocation(
        destinationLocationId,
        actor.playerId,
      );
      data.proposerDestinationLocationId = destinationLocationId;
    }
    data.proposerCommittedAt = new Date();
    eventType = "proposer_confirmed_physical_exchange";
  } else if (actor.playerId === trade.receiverPlayerId) {
    if (trade.receiverCommittedAt)
      throw new Error("You have already confirmed this physical exchange.");
    if (destinationLocationId) {
      await assertTradeDestinationLocation(
        destinationLocationId,
        actor.playerId,
      );
      data.receiverDestinationLocationId = destinationLocationId;
    }
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
  revalidatePath("/wishlist");
}
