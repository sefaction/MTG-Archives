"use client";

import { useActionState, type ReactNode } from "react";
import { initialTradeProposalActionState, type TradeProposalActionState } from "@/lib/trade-proposal";

export function TradeActionForm({ action, children, className }: {
  action: (previous: TradeProposalActionState, data: FormData) => Promise<TradeProposalActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, submit] = useActionState(action, initialTradeProposalActionState);
  return <form action={submit} className={className}>
    {children}
    {state.message ? <p role="status" className="w-full break-words text-sm text-amber-200">{state.message}</p> : null}
  </form>;
}
