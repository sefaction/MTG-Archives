import { TradeStatus } from "@prisma/client";

export type TradePolicyInput = {
  actorOwnerId?: string | null;
  isAdmin?: boolean;
  proposerOwnerId: string;
  recipientOwnerId: string;
  status: TradeStatus;
};

const terminalStatuses: TradeStatus[] = [
  TradeStatus.COMPLETED,
  TradeStatus.DECLINED,
  TradeStatus.CANCELLED,
  TradeStatus.CANCELED,
];

export function isTerminalTradeStatus(status: TradeStatus) {
  return terminalStatuses.includes(status);
}

export function assertCanAcceptTrade(input: TradePolicyInput) {
  if (input.actorOwnerId !== input.recipientOwnerId)
    throw new Error("Only the receiver can accept this trade.");
  if (input.status !== TradeStatus.PROPOSED)
    throw new Error("Only proposed trades can be accepted.");
}

export function assertCanDeclineTrade(input: TradePolicyInput) {
  if (input.actorOwnerId !== input.recipientOwnerId)
    throw new Error("Only the receiver can decline this trade.");
  if (input.status !== TradeStatus.PROPOSED)
    throw new Error("Only proposed trades can be declined.");
}

export function assertCanCancelTrade(input: TradePolicyInput) {
  if (isTerminalTradeStatus(input.status))
    throw new Error("This trade can no longer be cancelled.");
  if (!input.isAdmin && input.actorOwnerId !== input.proposerOwnerId)
    throw new Error("Only the proposer can cancel this trade.");
  if (!input.isAdmin && input.status !== TradeStatus.PROPOSED)
    throw new Error("Only proposed trades can be cancelled by the proposer.");
}
