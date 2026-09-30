import { ScannerRequestError } from "./scanner-errors";
export async function readScannerJson(request: Request, limit: number) {
  if (!request.body) throw new ScannerRequestError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new ScannerRequestError(413);
      chunks.push(result.value);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { throw new ScannerRequestError(400); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
