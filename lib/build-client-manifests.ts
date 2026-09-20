import { runInNewContext } from "node:vm";

export const CLIENT_MANIFEST_CONTRACTS: Record<string, string[]> = {
  "/imports/page": [
    "SingleCardInventoryAdd",
    "InventoryExportForm",
    "StorageDestinationPicker",
    "ImportProgressPanel",
  ],
  "/inventory/page": ["InventoryAdvancedSearch", "InventoryBrowser"],
  "/public/inventory/page": ["InventoryAdvancedSearch", "InventoryBrowser"],
  "/locations/page": [
    "LocationMoveForm",
    "LocationContentsDeleteForm",
    "VaultSectionMap",
  ],
  "/decks/[deckId]/import/page": ["DeckImportPanel"],
  "/decks/[deckId]/playtest/page": ["PlaytestSandbox"],
};

// Only evaluate locally generated build artifacts, never uploaded/user input.
export function checkClientManifest(
  source: string,
  route: string,
  components: string[],
  chunkExists: (relativePath: string) => boolean,
) {
  const context = { globalThis: {} as Record<string, any> };
  runInNewContext(source, context, { timeout: 1000 });
  const modules = context.globalThis.__RSC_MANIFEST?.[route]?.clientModules;
  if (!modules || typeof modules !== "object")
    throw new Error(`${route}: missing client module map`);
  for (const component of components) {
    const suffix = `/components/${component}.tsx`;
    const entry = Object.entries(modules).find(([path]) =>
      path.replaceAll("\\", "/").endsWith(suffix),
    )?.[1] as { id?: string | number; chunks?: unknown[] } | undefined;
    if (!entry || entry.id === undefined || !Array.isArray(entry.chunks))
      throw new Error(`${route}: missing client reference for ${component}`);
    const chunks = entry.chunks.filter(
      (chunk): chunk is string =>
        typeof chunk === "string" && chunk.startsWith("static/chunks/"),
    );
    if (!chunks.length)
      throw new Error(`${route}: no client chunks for ${component}`);
    for (const chunk of chunks) {
      const diskChunk = decodeURIComponent(chunk);
      if (diskChunk.includes("..") || !chunkExists(diskChunk))
        throw new Error(`${route}: missing/invalid client chunk ${chunk}`);
    }
  }
}
