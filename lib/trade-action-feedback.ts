import { DeckTradeValidationError } from "./deck-trade-policy";
import { DeckTradeWriteError } from "./deck-write-fence";
import type { TradeProposalActionState } from "./trade-proposal";

// Only known business rejections become participant feedback. Database,
// programming and framework errors retain their normal error boundary.
const expectedMessages = new Set([
  "This trade is not awaiting physical confirmation.",
  "You have already confirmed this physical exchange.",
  "This physical exchange was already confirmed or is no longer awaiting confirmation.",
  "Choose a destination location for the incoming cards.",
  "Choose an active normal location for the incoming card.",
  "Selected trade destination location is not available.",
  "A traded deck is unavailable.",
  "A traded deck changed. Cancel this offer and review its contents again.",
  "One or more traded cards are no longer available.",
  "Trade inventory ownership changed before completion.",
  "The recipient must choose organization and confirm deck visibility.",
  "Only the actual deck owner can accept its transfer.",
  "Only proposed trades can be accepted.",
]);

export function tradeActionFeedback(error: unknown): TradeProposalActionState {
  if (error instanceof DeckTradeValidationError || error instanceof DeckTradeWriteError ||
      (error instanceof Error && expectedMessages.has(error.message))) {
    return { status: "error", message: (error as Error).message };
  }
  throw error;
}
