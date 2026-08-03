export const MAX_TRADE_ACTION_NOTE_LENGTH = 1000;

export function normalizeTradeActionNote(value: unknown, fallback: string) {
  const note = String(value ?? "").trim() || fallback;
  return note.slice(0, MAX_TRADE_ACTION_NOTE_LENGTH);
}
