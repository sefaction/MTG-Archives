/** Local wall-clock hour in the DST-aware Central maintenance window. */
export function inPricingMaintenanceWindow(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return hour >= 2 && hour < 5;
}

export function pricingMaintenanceMinutesRemaining(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour >= 2 && hour < 5 ? 300 - hour * 60 - minute : 0;
}

/** Wall-clock time left before 05:00 Central, including seconds for step budgets. */
export const PRICING_RAW_STAGE_BUDGET_MS = 72 * 60_000; // Six-minute stage, 65-minute activation, one-minute margin.
export const PRICING_RAW_ACTIVATION_BUDGET_MS = 66 * 60_000;
export function pricingMaintenanceMillisecondsRemaining(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);
  return hour >= 2 && hour < 5
    ? ((5 - hour) * 60 * 60 - minute * 60 - second) * 1_000 - at.getMilliseconds()
    : 0;
}
