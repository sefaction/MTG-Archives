import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminModeEnabled, isAdminUser } from "@/lib/auth";
import { saveUploadedBackupArchive } from "@/lib/backup";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  const adminModeActive = user ? await isAdminModeEnabled(user) : false;
  if (!user || !isAdminUser(user, user.player) || !adminModeActive) {
    return NextResponse.redirect(
      new URL("/dashboard?auth=admin-mode", request.url),
      303,
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("backupFile");
    if (!(file instanceof File)) throw new Error("Choose a backup archive.");
    if (!file.name.endsWith(".tar.gz")) {
      throw new Error("Backup uploads must be .tar.gz archives.");
    }
    await saveUploadedBackupArchive(
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
    return NextResponse.redirect(
      new URL("/admin/backups?uploaded=1", request.url),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backup upload failed.";
    const url = new URL("/admin/backups", request.url);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url, 303);
  }
}
