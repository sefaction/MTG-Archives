/** Keep the maintenance lease alive during asynchronous setup work. */
export async function withPricingMaintenanceLease<T>(
  task: () => Promise<T>, heartbeat: () => boolean, intervalMs = 20_000,
): Promise<{ value: T; leaseLost: boolean }> {
  let leaseLost = false;
  const timer = setInterval(() => {
    try {
      if (!heartbeat()) leaseLost = true;
    } catch {
      leaseLost = true;
    }
    if (leaseLost) clearInterval(timer);
  }, intervalMs);
  try {
    return { value: await task(), leaseLost };
  } finally {
    clearInterval(timer);
  }
}
