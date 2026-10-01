import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { findScannerInstaller, scannerInstallerFilename } from "@/lib/scanner-installer";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  try {
    await acquisitionActor(request);
    const installer = await findScannerInstaller();
    if (new URL(request.url).searchParams.has("info")) {
      return Response.json({ available: !!installer, version: installer?.version ?? null }, { headers });
    }
    if (!installer) return Response.json({ error: "Scanner installer is not available yet." }, { status: 404, headers });
    return new Response(Readable.toWeb(createReadStream(installer.path)) as ReadableStream, {
      headers: { ...headers, "Content-Type": "application/octet-stream",
        "Content-Length": String(installer.size),
        "Content-Disposition": `attachment; filename="${scannerInstallerFilename}"` },
    });
  } catch (error) { return acquisitionError(error); }
}