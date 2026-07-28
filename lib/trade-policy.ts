import { TradeStatus } from "@prisma/client";

export type TradePolicyInput = {
  actorOwnerId?: string | null;
  isAdmin?: boolean;
  proposerOwnerId: string;
  recipientOwnerId: string;
  status: TradeStatus;
};

export type CounterTradePolicyInput = TradePolicyInput & {
  counterProposerOwnerId: string;
  counterRecipientOwnerId: string;
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

export function assertCanCounterTrade(input: CounterTradePolicyInput) {
  if (!input.isAdmin && input.actorOwnerId !== input.recipientOwnerId)
    throw new Error("Only the receiver can counter this trade.");
  if (input.status !== TradeStatus.PROPOSED)
    throw new Error("Only proposed trades can be countered.");
  if (
    input.counterProposerOwnerId !== input.recipientOwnerId ||
    input.counterRecipientOwnerId !== input.proposerOwnerId
  ) {
    throw new Error(
      "A counter proposal must reverse the original trade participants.",
    );
  }
}

export function assertCanCancelTrade(input: TradePolicyInput) {
  if (isTerminalTradeStatus(input.status))
    throw new Error("This trade can no longer be cancelled.");
  if (!input.isAdmin && input.actorOwnerId !== input.proposerOwnerId)
    throw new Error("Only the proposer can cancel this trade.");
  if (!input.isAdmin && input.status !== TradeStatus.PROPOSED)
    throw new Error("Only proposed trades can be cancelled by the proposer.");
}
