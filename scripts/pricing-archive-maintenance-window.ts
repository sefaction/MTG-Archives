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
