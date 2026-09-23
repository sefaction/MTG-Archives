import { getCurrentUser, isAdminModeEnabled, isAdminUser } from "@/lib/auth";
import { getPricingHistoryTotals } from "@/lib/pricing-db-query";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return Response.json({ error: "Log in required." }, { status: 401 });
  if (!isAdminUser(user, user.player) || !(await isAdminModeEnabled(user)))
    return Response.json({ error: "Admin mode required." }, { status: 403 });
  try {
    return Response.json(await getPricingHistoryTotals(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "History totals could not be calculated within the time limit. Check worker health and try again.",
      },
      { status: 503 },
    );
  }
}
