export type PricingRetentionPolicy = {
  dailyDays: number;
  weeklyYears: number;
  monthlyYears: number;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

export function getPricingRetentionPolicy(
  environment: Record<string, string | undefined> = process.env,
): PricingRetentionPolicy {
  const dailyDays = boundedInteger(
    environment.PRICING_DAILY_HISTORY_DAYS,
    90,
    365,
  );
  const weeklyYears = boundedInteger(
    environment.PRICING_WEEKLY_HISTORY_YEARS,
    2,
    20,
  );
  const monthlyYears = boundedInteger(
    environment.PRICING_MONTHLY_HISTORY_YEARS,
    10,
    100,
  );
  if (weeklyYears * 365 <= dailyDays || monthlyYears <= weeklyYears)
    return { dailyDays: 90, weeklyYears: 2, monthlyYears: 10 };
  return { dailyDays, weeklyYears, monthlyYears };
}
