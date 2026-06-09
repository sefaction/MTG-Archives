import { NextResponse } from "next/server";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const { searchParams } = new URL(request.url);
  const itemIds = (searchParams.get("itemIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!itemIds.length) return NextResponse.json({ entries: [] });

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, currentOwnerId: true, cardId: true },
  });
  const allowedItemIds = new Set(
    items
      .filter(
        (item) =>
          scope?.mode === "admin" ||
          (user.playerId && item.currentOwnerId === user.playerId),
      )
      .map((item) => item.id),
  );

  if (!allowedItemIds.size) return NextResponse.json({ entries: [] });

  const allowedItems = items.filter((item) => allowedItemIds.has(item.id));
  const cardOwnerAuditScopes = allowedItems.map((item) => ({
    OR: [
      {
        beforeJson: {
          path: ["cardId"],
          equals: item.cardId,
        },
      },
      {
        afterJson: {
          path: ["cardId"],
          equals: item.cardId,
        },
      },
    ],
    AND: [
      {
        OR: [
          {
            beforeJson: {
              path: ["currentOwnerId"],
              equals: item.currentOwnerId,
            },
          },
          {
            afterJson: {
              path: ["currentOwnerId"],
              equals: item.currentOwnerId,
            },
          },
        ],
      },
    ],
  }));

  const logs = await prisma.inventoryAuditLog.findMany({
    where: {
      OR: [
        { inventoryItemId: { in: [...allowedItemIds] } },
        ...cardOwnerAuditScopes,
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      changedByUser: { select: { displayName: true, username: true } },
    },
  });

  return NextResponse.json({
    entries: logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      changedBy:
        log.changedByUser?.displayName || log.changedByUser?.username || null,
      changeType: log.changeType,
      reason: log.reason,
      beforeJson: log.beforeJson,
      afterJson: log.afterJson,
    })),
  });
}
