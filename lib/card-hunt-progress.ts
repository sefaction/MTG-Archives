import type { HuntPick, HuntPlan } from "./card-hunt";
import type { HuntActionResult } from "./card-hunt-action-policy";

export const huntPickKey = (
  pick: Pick<HuntPick, "requestId" | "inventoryItemId">,
) => JSON.stringify([pick.requestId, pick.inventoryItemId]);
export function advanceHunt<T extends HuntPlan>(
  plan: T,
  selected: Array<{
    requestId: string;
    inventoryItemId: string;
    quantity: number;
  }>,
  result: HuntActionResult,
): T {
  if (result.status !== "APPLIED") return plan;
  const moved = new Map(
    selected.map((pick) => [huntPickKey(pick), pick.quantity]),
  );
  const perRequest = new Map<string, number>();
  for (const pick of selected)
    perRequest.set(
      pick.requestId,
      (perRequest.get(pick.requestId) ?? 0) + pick.quantity,
    );
  const stamps = new Map(
    result.stockUpdates.map((item) => [item.id, item.stamp]),
  );
  const targets = new Map(
    result.targetUpdates?.map((item) => [item.requestId, item.stamp]) ?? [],
  );
  return {
    ...plan,
    planned: Math.max(0, plan.planned - result.quantity),
    alreadyInDeck:
      plan.alreadyInDeck + (result.action === "COMMIT" ? result.quantity : 0),
    boxes: plan.boxes
      .map((box) => ({
        ...box,
        picks: box.picks
          .map((pick) => ({
            ...pick,
            ...(pick.pulledQuantity
              ? {
                  pulledQuantity: Math.max(
                    0,
                    pick.pulledQuantity - (moved.get(huntPickKey(pick)) ?? 0),
                  ),
                  pulled:
                    Math.max(
                      0,
                      pick.pulledQuantity - (moved.get(huntPickKey(pick)) ?? 0),
                    ) ===
                    pick.quantity - (moved.get(huntPickKey(pick)) ?? 0),
                }
              : {}),
            quantity: pick.quantity - (moved.get(huntPickKey(pick)) ?? 0),
            stamp: stamps.get(pick.inventoryItemId) ?? pick.stamp,
            targetStamp: targets.get(pick.requestId) ?? pick.targetStamp,
          }))
          .filter((pick) => pick.quantity > 0),
      }))
      .filter((box) => box.picks.length),
    lines: plan.lines.map((line) => ({
      ...line,
      planned: Math.max(
        0,
        line.planned - (perRequest.get(line.request.id) ?? 0),
      ),
      request: {
        ...line.request,
        targetStamp: targets.get(line.request.id) ?? line.request.targetStamp,
        alreadyInDeck:
          (line.request.alreadyInDeck ?? 0) +
          (result.action === "COMMIT"
            ? (perRequest.get(line.request.id) ?? 0)
            : 0),
      },
    })),
  };
}
