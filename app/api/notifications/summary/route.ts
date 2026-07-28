import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUnreadNotificationCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const unreadCount = await getUnreadNotificationCount(user.id);
  return NextResponse.json(
    { unreadCount },
    { headers: { "Cache-Control": "no-store" } },
  );
}
