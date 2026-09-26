import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import Papa from "papaparse";
import type { MtgjsonPriceSnapshotInput } from "../lib/pricing-mtgjson";
import { archivedFeedFingerprint } from "./pricing-archived-feed";
import { rawSegmentColumns } from "./pricing-raw-segment-common";

export type ArchiveSegmentRecord = {
  observedDate: string; archivePath: string; archiveSha256: string;
  csvSha256: string; identityFingerprint: string; rawRows: number;
  generation: number;
} | null;
export type ArchivedFeedQueueRecord = {
  observedDate: string; identityFingerprint: string; spoolPath: string;
  spoolSha256: string; rowCount: number;
};
type ArchivedRawRow = Record<string, string> & {
  mtgjson_uuid: string; provider: string; finish: string; price_type: string;
  currency: string; observed_date: string; price: string;
};

const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const identity = (row: { mtgjson_uuid?: string; mtgjsonUuid?: string;
  provider: string; finish: string; price_type?: string; priceType?: string;
  currency: string; observed_date?: string; observedDate?: string }) =>
  [row.mtgjson_uuid ?? row.mtgjsonUuid, row.provider, row.finish,
    row.price_type ?? row.priceType, row.currency,
    row.observed_date ?? row.observedDate].join("\x1f");

function withinRoot(root: string, file: string) {
  const resolved = resolve(file);
  if (!resolved.startsWith(`${resolve(root)}${sep}`))
    throw new Error("Archived Pricing file is outside BACKUP_DIR/pricing");
  return resolved;
}

function openVerifiedGzip(root: string, path: string, expectedSha256: string) {
  const stored = readFileSync(withinRoot(root, path));
  if (digest(stored) !== expectedSha256)
    throw new Error("Archived Pricing file hash differs from durable metadata");
  return gunzipSync(stored);
}

/** Read-only reconciliation. Missing feed identities never imply deletion. */
export function planArchivedCorrection(root: string, date: string,
  segment: ArchiveSegmentRecord, queued: ArchivedFeedQueueRecord) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || queued.observedDate !== date ||
      (segment && segment.observedDate !== date))
    throw new Error("Archived Pricing date and metadata disagree");
  const archiveRoot = resolve(root, "pricing");
  const feedBytes = openVerifiedGzip(archiveRoot, queued.spoolPath,
    queued.spoolSha256);
  if (feedBytes.length > 64 * 1024 * 1024)
    throw new Error("Archived feed exceeds the 64 MiB reconciliation budget");
  const feed = JSON.parse(feedBytes.toString("utf8")) as {
    schemaVersion: number; date: string; fingerprint: string;
    rows: MtgjsonPriceSnapshotInput[] };
  if (feed.schemaVersion !== 1 || feed.date !== date ||
      feed.fingerprint !== queued.identityFingerprint ||
      feed.rows.length !== queued.rowCount ||
      archivedFeedFingerprint(feed.rows) !== queued.identityFingerprint ||
      feed.rows.some((row) => row.observedDate !== date))
    throw new Error("Archived feed spool does not match its queued identity set");
  const feedKeys = new Set(feed.rows.map(identity));
  if (feedKeys.size !== feed.rows.length)
    throw new Error("Archived feed spool contains duplicate identities");

  const columns = rawSegmentColumns.split(", ");
  let oldRows: ArchivedRawRow[] = [];
  if (segment) {
    const archiveBytes = openVerifiedGzip(archiveRoot, segment.archivePath,
      segment.archiveSha256);
    if (archiveBytes.length > 64 * 1024 * 1024 ||
        digest(archiveBytes) !== segment.csvSha256)
      throw new Error("Activated raw archive no longer matches its CSV proof");
    const parsed = Papa.parse<ArchivedRawRow>(archiveBytes.toString("utf8"),
      { header: true, skipEmptyLines: true });
    if (parsed.errors.length || parsed.data.length !== segment.rawRows ||
        columns.some((column) => !parsed.meta.fields?.includes(column)))
      throw new Error("Activated raw archive row set or schema is invalid");
    oldRows = parsed.data;
  }
  const oldKeys = new Map(oldRows.map((row) => [identity(row), row]));
  if (oldKeys.size !== oldRows.length ||
      oldRows.some((row) => row.observed_date !== date))
    throw new Error("Activated raw archive contains duplicate or wrong-date identities");

  let corrected = 0, unchanged = 0, added = 0;
  for (const row of feed.rows) {
    const old = oldKeys.get(identity(row));
    if (!old) { added++; continue; }
    if (Number(old.price) === Number(row.price.toFixed(4))) unchanged++;
    else corrected++;
  }
  const missing = [...oldKeys.keys()].filter((key) => !feedKeys.has(key)).length;
  return { observedDate: date, priorGeneration: segment?.generation ?? 0,
    archivedRows: oldRows.length, feedRows: feed.rows.length,
    corrected, added, unchanged, missing,
    queueFingerprint: queued.identityFingerprint,
    rows: feed.rows };
}
