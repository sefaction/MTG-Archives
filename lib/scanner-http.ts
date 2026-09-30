export async function readScannerJson(request: Request, limit: number) {
  if (!request.body) throw new Error("Scanner request unavailable");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error("Scanner request too large");
      chunks.push(result.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
