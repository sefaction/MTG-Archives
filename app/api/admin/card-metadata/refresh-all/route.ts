import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdminModeEnabled, isAdminUser } from "@/lib/auth";
import { refreshAllCachedCardMetadata } from "@/lib/card-metadata-refresh";

async function requireApiAdminMode() {
  const user = await getCurrentUser();
  const adminModeActive = user ? await isAdminModeEnabled(user) : false;
  return Boolean(user && isAdminUser(user, user.player) && adminModeActive);
}

export async function POST() {
  if (!(await requireApiAdminMode())) {
    return NextResponse.json(
      { error: "Admin mode required." },
      { status: 403 },
    );
  }

  try {
    const result = await refreshAllCachedCardMetadata();
    revalidatePath("/inventory");
    revalidatePath("/public/inventory");
    revalidatePath("/admin");
    revalidatePath("/admin/metadata");
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Metadata refresh failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
