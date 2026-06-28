import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdminModeEnabled, isAdminUser } from "@/lib/auth";
import { refreshCommanderBracketMetadata } from "@/lib/commander-brackets";

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
    const result = await refreshCommanderBracketMetadata();
    revalidatePath("/admin");
    revalidatePath("/admin/metadata");
    revalidatePath("/decks");
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Commander bracket refresh failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
