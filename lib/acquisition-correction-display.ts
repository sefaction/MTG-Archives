import { z } from "zod";
// Browser-safe bookkeeping only. Signing and saved-job resolution stay server-side.
export const correctionDisplayTokensSchema = z.object({
  initial: z.string().max(20000).optional(),
  edit: z.string().max(20000).optional(),
  current: z.string().max(20000).optional(),
  displayed: z.array(z.string().max(20000)).max(16).default([]),
  truncated: z.boolean().optional(),
}).strict();
export type CorrectionDisplayTokens = z.infer<typeof correctionDisplayTokensSchema>;
export function rememberCorrectionDisplay(current: CorrectionDisplayTokens, token?: string) {
  if (!token) return current;
  if (current.displayed.includes(token)) return { ...current, current: token };
  const displayed = [...current.displayed, token];
  return { ...current, initial: current.initial ?? token, current: token, displayed: displayed.slice(-16),
    ...(displayed.length > 16 ? { truncated: true } : {}) };
}
