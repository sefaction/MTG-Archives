import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminModeEnabled, isAdminUser } from "@/lib/auth";
import { getBackupPathForFilename, readManifestFromBackup } from "@/lib/backup";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const user = await getCurrentUser();
  const adminModeActive = user ? await isAdminModeEnabled(user) : false;
  if (!user || !isAdminUser(user, user.player) || !adminModeActive) {
    return NextResponse.redirect(
      new URL("/dashboard?auth=admin-mode", request.url),
      303,
    );
  }

  const { filename } = await params;
  try {
    const safeFilename = decodeURIComponent(filename);
    const backupPath = getBackupPathForFilename(safeFilename);
    await readManifestFromBackup(backupPath);
    const info = await stat(backupPath);
    const stream = Readable.toWeb(createReadStream(backupPath));

    return new Response(stream as ReadableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${safeFilename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Backup download failed.",
      },
      { status: 404 },
    );
  }
}
