/** Exact physical marks, independent of the current page or filter. */
export function markedPullSelection(
  rows: Array<{ id: string; quantity: number; pulled?: number }>,
) {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const quantity = Math.min(row.quantity, row.pulled ?? 0);
      return Number.isSafeInteger(quantity) && quantity > 0
        ? [[row.id, quantity]]
        : [];
    }),
  );
}
