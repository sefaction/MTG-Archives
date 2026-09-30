import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const filename = "MTGArchivesScannerSetup.exe";

export async function GET(request: Request) {
  try {
    await acquisitionActor(request);
    const path = join(process.env.IMPORTS_DATA_PATH ?? "/app/data/imports", "scanner-installer", filename);
    const info = await stat(path).catch(() => null);
    const available = !!info?.isFile() && info.size > 0 && info.size < 1024 * 1024 * 1024;
    if (new URL(request.url).searchParams.has("info"))
      return Response.json({ available }, { headers });
    if (!available || !info) return Response.json({ error: "Scanner installer is not available yet." }, { status: 404, headers });
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { ...headers, "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (error) { return acquisitionError(error); }
}
