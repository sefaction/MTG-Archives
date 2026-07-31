export type TradeProposalActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export const initialTradeProposalActionState: TradeProposalActionState = {
  status: "idle",
  message: "",
};

export class TradeProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeProposalValidationError";
  }
}

export function asTradeProposalValidationError(error: unknown) {
  return error instanceof TradeProposalValidationError
    ? error
    : new TradeProposalValidationError(
        error instanceof Error
          ? error.message
          : "The trade proposal is invalid.",
      );
}

export function tradeProposalValidationState(
  error: unknown,
): TradeProposalActionState | null {
  return error instanceof TradeProposalValidationError
    ? { status: "error", message: error.message }
    : null;
}
