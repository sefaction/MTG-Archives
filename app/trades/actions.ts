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
  assertCanCounterTrade,
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
import { recordTradeEvent } from "@/lib/trade-notifications";
import {
  asTradeProposalValidationError,
  tradeProposalValidationState,
  TradeProposalValidationError,
  type TradeProposalActionState,
} from "@/lib/trade-proposal";
import { normalizeTradeActionNote } from "@/lib/trade-notes";
import { enqueueTradeAnnouncementDeliveries } from "@/lib/webhook-delivery";

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

async function validateProposedTrade(
  data: ProposedTradeData,
  ignoredReservationTradeId?: string,
) {
  if (data.proposerPlayerId === data.receiverPlayerId)
    throw new TradeProposalValidationError(
      "Proposer and recipient must be different users.",
    );
  if (!data.offeredLines.length || !data.requestedLines.length) {
    throw new TradeProposalValidationError(
      "Choose at least one card on each side of the trade.",
    );
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
        throw new TradeProposalValidationError(ownershipError);
      }
      if (item.location?.kind === InventoryLocationKind.DECK) {
        throw new TradeProposalValidationError(
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
        trade: {
          status: { in: activeStatuses },
          ...(ignoredReservationTradeId
            ? { id: { not: ignoredReservationTradeId } }
            : {}),
        },
      },
      select: { inventoryItemId: true, quantity: true },
    }),
    prisma.trade.findMany({
      where: {
        status: { in: activeStatuses },
        ...(ignoredReservationTradeId
          ? { id: { not: ignoredReservationTradeId } }
          : {}),
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
      throw new TradeProposalValidationError(
        "One or more selected quantities are already reserved or unavailable.",
      );
    }
  }
  return { offered, requested };
}

function tradeLinesFromForm(fd: FormData) {
  const legacyOfferedId = String(fd.get("offeredInventoryItemId") || "");
  const legacyRequestedId = String(fd.get("requestedInventoryItemId") || "");
  try {
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
  } catch (error) {
    throw asTradeProposalValidationError(error);
  }
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

async function createTradeMutation(fd: FormData) {
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
  const counterTradeId = String(fd.get("counterTradeId") || "").trim();
  const counterSource = counterTradeId
    ? await prisma.trade.findUnique({
        where: { id: counterTradeId },
        select: {
          id: true,
          proposerPlayerId: true,
          receiverPlayerId: true,
          status: true,
        },
      })
    : null;
  if (counterTradeId && !counterSource) {
    throw new TradeProposalValidationError(
      "The trade being countered no longer exists.",
    );
  }
  if (counterSource) {
    try {
      assertCanCounterTrade({
        actorOwnerId: actor.playerId,
        isAdmin: actorIsAdmin,
        proposerOwnerId: counterSource.proposerPlayerId,
        recipientOwnerId: counterSource.receiverPlayerId,
        status: counterSource.status,
        counterProposerOwnerId: data.proposerPlayerId,
        counterRecipientOwnerId: data.receiverPlayerId,
      });
    } catch (error) {
      throw asTradeProposalValidationError(error);
    }
  }
  const { offered, requested } = await validateProposedTrade(
    data,
    counterSource?.id,
  );
  const createData = {
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
  };
  await prisma.$transaction(async (tx) => {
    if (counterSource) {
      const replaced = await tx.trade.updateMany({
        where: {
          id: counterSource.id,
          status: TradeStatus.PROPOSED,
        },
        data: {
          status: TradeStatus.DECLINED,
          declinedAt: new Date(),
        },
      });
      if (replaced.count !== 1) {
        throw new TradeProposalValidationError(
          "This trade changed before the counter was submitted. Reload and try again.",
        );
      }
      const counter = await tx.trade.create({ data: createData });
      await recordTradeEvent(tx, {
        tradeId: counterSource.id,
        eventType: "countered",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: `Replaced by counter proposal ${counter.id}.`,
      });
      await recordTradeEvent(tx, {
        tradeId: counter.id,
        eventType: "counter_proposed",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: `Counter proposed with ${offered.length} offered and ${requested.length} requested card lines.`,
        notification: {
          type: "trade.countered",
          title: `${actor.displayName} countered your trade`,
          message: "Review the updated card exchange in Active Trades.",
          recipientPlayerIds: [data.receiverPlayerId],
        },
      });
      return;
    }
    const trade = await tx.trade.create({ data: createData });
    await recordTradeEvent(tx, {
      tradeId: trade.id,
      eventType: "proposed",
      actorUserId: actor.id,
      actorPlayerId: actor.playerId,
      message: `Trade proposed with ${offered.length} offered and ${requested.length} requested card lines.`,
      notification: {
        type: "trade.proposed",
        title: `${actor.displayName} sent you a trade proposal`,
        message: "Review the offered and requested cards in Active Trades.",
        recipientPlayerIds: [data.receiverPlayerId],
      },
    });
  });
  revalidatePath("/trades");
  revalidatePath("/notifications");
}

export async function createTrade(
  _previousState: TradeProposalActionState,
  fd: FormData,
): Promise<TradeProposalActionState> {
  try {
    await createTradeMutation(fd);
    return {
      status: "success",
      message: "Trade proposal sent.",
    };
  } catch (error) {
    const validationState = tradeProposalValidationState(error);
    if (validationState) return validationState;
    throw error;
  }
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

export async function updateTradeWishlistQuantity(fd: FormData) {
  const actor = await requireLogin();
  const actorScope = await getAccessScope(actor);
  const actorIsAdmin = actorScope?.mode === "admin";
  const tradeWishlistItemId = String(fd.get("tradeWishlistItemId") || "");
  const quantity = Number(fd.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("Trade wishlist quantity must be between 1 and 999.");
  }
  const item = await prisma.tradeWishlistItem.findUnique({
    where: { id: tradeWishlistItemId },
    select: { id: true, ownerUserId: true, status: true },
  });
  if (!item) throw new Error("Trade wishlist item not found.");
  if (!actorIsAdmin && item.ownerUserId !== actor.id) {
    throw new Error("You can only update your own trade wishlist cards.");
  }
  if (item.status !== TradeWishlistStatus.OPEN) {
    throw new Error("Only open trade wishlist cards can be updated.");
  }
  await prisma.tradeWishlistItem.update({
    where: { id: item.id },
    data: { quantity },
  });
  revalidatePath("/trades");
  revalidatePath("/wishlist");
  revalidatePath("/public/inventory");
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
    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.ACCEPTED_PENDING_EXCHANGE,
          acceptedAt: now,
        },
      });
      await recordTradeEvent(tx, {
        tradeId: trade.id,
        eventType: "accepted",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: "Trade accepted; awaiting physical exchange.",
        notification: {
          type: "trade.accepted",
          title: `${actor.displayName} accepted your trade`,
          message: "The trade is ready for physical exchange confirmation.",
          recipientPlayerIds: [trade.proposerPlayerId],
        },
      });
    });
  } else if (action === "decline") {
    assertCanDeclineTrade({
      actorOwnerId: actor.playerId,
      isAdmin: actorIsAdmin,
      proposerOwnerId: trade.proposerPlayerId,
      recipientOwnerId: trade.receiverPlayerId,
      status: trade.status,
    });
    const reason = normalizeTradeActionNote(
      fd.get("reason"),
      "Trade declined.",
    );
    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.DECLINED,
          declinedAt: now,
        },
      });
      await recordTradeEvent(tx, {
        tradeId: trade.id,
        eventType: "declined",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: reason,
        notification: {
          type: "trade.declined",
          title: `${actor.displayName} declined your trade`,
          message: reason,
          recipientPlayerIds: [trade.proposerPlayerId],
        },
      });
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
    const eventType =
      actorIsAdmin && actor.playerId !== trade.proposerPlayerId
        ? "admin_cancelled"
        : "cancelled";
    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.CANCELLED,
          cancelledAt: now,
        },
      });
      await recordTradeEvent(tx, {
        tradeId: trade.id,
        eventType,
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: reason,
        notification: {
          type: "trade.cancelled",
          title: `${actor.displayName} cancelled a trade`,
          message: reason,
          recipientPlayerIds:
            eventType === "admin_cancelled"
              ? [trade.proposerPlayerId, trade.receiverPlayerId]
              : [trade.receiverPlayerId],
        },
      });
    });
  } else {
    throw new Error("Unknown trade action.");
  }
  revalidatePath("/trades");
  revalidatePath("/notifications");
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
      },
    });
    await recordTradeEvent(tx, {
      tradeId,
      eventType: "completed",
      actorUserId,
      message: reason,
      notification: {
        type: "trade.completed",
        title: "Trade completed",
        message: `${trade.proposerPlayer.displayName} and ${trade.receiverPlayer.displayName}'s inventory has been updated.`,
        recipientPlayerIds: [trade.proposerPlayerId, trade.receiverPlayerId],
      },
    });
    await enqueueTradeAnnouncementDeliveries(
      {
        tradeId,
        proposerName: trade.proposerPlayer.displayName,
        receiverName: trade.receiverPlayer.displayName,
        offeredCards: resolvedLines
          .filter((line) => line.side === TradeLineSide.PROPOSER)
          .map((line) => {
            const images = line.inventoryItem.card.imageUris as {
              normal?: string;
              small?: string;
              large?: string;
            } | null;
            return {
              name: line.inventoryItem.card.name,
              quantity: line.quantity,
              setCode: line.inventoryItem.card.setCode,
              collectorNumber: line.inventoryItem.card.collectorNumber,
              imageUrl:
                images?.normal ??
                images?.large ??
                images?.small ??
                line.inventoryItem.card.imageUri,
            };
          }),
        requestedCards: resolvedLines
          .filter((line) => line.side === TradeLineSide.RECEIVER)
          .map((line) => {
            const images = line.inventoryItem.card.imageUris as {
              normal?: string;
              small?: string;
              large?: string;
            } | null;
            return {
              name: line.inventoryItem.card.name,
              quantity: line.quantity,
              setCode: line.inventoryItem.card.setCode,
              collectorNumber: line.inventoryItem.card.collectorNumber,
              imageUrl:
                images?.normal ??
                images?.large ??
                images?.small ??
                line.inventoryItem.card.imageUri,
            };
          }),
        createdAt: new Date(),
      },
      tx,
    );
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
    await prisma.$transaction((tx) =>
      recordTradeEvent(tx, {
        tradeId: trade.id,
        eventType: "admin_force_complete",
        actorUserId: actor.id,
        actorPlayerId: actor.playerId,
        message: reason,
      }),
    );
    await completeTradeIfReady(trade.id, actor.id, true);
    revalidatePath("/trades");
    revalidatePath("/wishlist");
    revalidatePath("/notifications");
    return;
  }
  let otherParticipantId: string;
  let willComplete = false;
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
    otherParticipantId = trade.receiverPlayerId;
    willComplete = Boolean(trade.receiverCommittedAt);
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
    otherParticipantId = trade.proposerPlayerId;
    willComplete = Boolean(trade.proposerCommittedAt);
  } else {
    throw new Error(
      "Only trade participants can confirm the physical exchange.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.trade.update({
      where: { id: trade.id },
      data,
    });
    await recordTradeEvent(tx, {
      tradeId: trade.id,
      eventType,
      actorUserId: actor.id,
      actorPlayerId: actor.playerId,
      message: "Physical exchange confirmed.",
      notification: willComplete
        ? undefined
        : {
            type: "trade.physical_confirmed",
            title: `${actor.displayName} confirmed the physical exchange`,
            message: "Confirm your side when the cards have changed hands.",
            recipientPlayerIds: [otherParticipantId],
          },
    });
  });
  await completeTradeIfReady(trade.id, actor.id);
  revalidatePath("/trades");
  revalidatePath("/wishlist");
  revalidatePath("/notifications");
}
