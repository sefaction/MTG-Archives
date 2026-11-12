import { type Prisma, TradeStatus } from "@prisma/client";
import { listPage, listPageSize } from "./list-browse";

export const activeTradeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];
export const terminalTradeStatuses: TradeStatus[] = [
  TradeStatus.COMPLETED,
  TradeStatus.DECLINED,
  TradeStatus.CANCELLED,
  TradeStatus.CANCELED,
];
export type TradeBrowseParams = {
  view?: string;
  historyQ?: string;
  historyStatus?: string;
  page?: string;
  pageSize?: string;
  counterTradeId?: string;
};

export function tradeVisibilityWhere(
  admin: boolean,
  playerId: string | null,
): Prisma.TradeWhereInput {
  return admin
    ? {}
    : playerId
      ? { OR: [{ proposerPlayerId: playerId }, { receiverPlayerId: playerId }] }
      : { id: { in: [] } };
}
export function readTradeHistory(params: TradeBrowseParams) {
  const selected = terminalTradeStatuses.find(
    (status) => status === params.historyStatus,
  );
  const status = selected === TradeStatus.CANCELED ? TradeStatus.CANCELLED : selected;
  return {
    query: (params.historyQ || "").trim().slice(0, 200),
    status,
    page: listPage(params.page),
    pageSize: listPageSize(params.pageSize),
  };
}
export function tradeHistoryWhere(
  visibility: Prisma.TradeWhereInput,
  params: TradeBrowseParams,
): Prisma.TradeWhereInput {
  const { query, status } = readTradeHistory(params);
  return {
    AND: [
      visibility,
      { status: status === TradeStatus.CANCELLED ? { in: [TradeStatus.CANCELLED, TradeStatus.CANCELED] } : status || { in: terminalTradeStatuses } },
      ...(query
        ? [
            {
              OR: [
                { id: { contains: query, mode: "insensitive" as const } },
                { message: { contains: query, mode: "insensitive" as const } },
                {
                  proposerPlayer: {
                    displayName: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  receiverPlayer: {
                    displayName: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}
export function tradeViewWhere(
  visibility: Prisma.TradeWhereInput,
  params: TradeBrowseParams,
): Prisma.TradeWhereInput {
  if (params.view === "history") return tradeHistoryWhere(visibility, params);
  if (params.view === "active")
    return { AND: [visibility, { status: { in: activeTradeStatuses } }] };
  // Desk and Wishlist render no trade history. Preserve an explicitly requested
  // authorized counter source; the page still validates receiver/partner/state.
  return { AND: [visibility, { id: params.counterTradeId || { in: [] } }] };
}
export function tradeStatusTotal(
  rows: { status: TradeStatus; _count: { _all: number } }[],
  statuses: readonly TradeStatus[],
) {
  return rows.reduce(
    (sum, row) => sum + (statuses.includes(row.status) ? row._count._all : 0),
    0,
  );
}
