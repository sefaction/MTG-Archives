import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { MtgjsonPriceSnapshotInput } from "../lib/pricing-mtgjson";

function canonical(snapshot: MtgjsonPriceSnapshotInput) {
  return [snapshot.mtgjsonUuid, snapshot.provider, snapshot.finish,
    snapshot.priceType, snapshot.currency, snapshot.observedDate,
    snapshot.price.toFixed(4)].join("\x1f");
}

function identity(snapshot: MtgjsonPriceSnapshotInput) {
  return [snapshot.mtgjsonUuid, snapshot.provider, snapshot.finish,
    snapshot.priceType, snapshot.currency, snapshot.observedDate].join("\x1f");
}

function unique(rows: MtgjsonPriceSnapshotInput[]) {
  const byIdentity = new Map<string, MtgjsonPriceSnapshotInput>();
  for (const row of rows) byIdentity.set(identity(row), row);
  return [...byIdentity.values()];
}

export function archivedFeedFingerprint(rows: MtgjsonPriceSnapshotInput[]) {
  const ordered = unique(rows).map(canonical).sort();
  const hash = createHash("md5");
  for (const row of ordered)
    hash.update(createHash("md5").update(row).digest("hex"));
  return hash.digest("hex");
}

export function splitArchivedFeed(
  rows: MtgjsonPriceSnapshotInput[], boundary: string | null,
  archivedFingerprints: Map<string, string>,
) {
  if (!boundary) return { live: rows, changed: [] as Array<{
    date: string; rows: MtgjsonPriceSnapshotInput[]; fingerprint: string }>,
    missingDates: [] as string[] };
  const live: MtgjsonPriceSnapshotInput[] = [];
  const old = new Map<string, MtgjsonPriceSnapshotInput[]>();
  for (const row of rows) {
    if (row.observedDate > boundary) { live.push(row); continue; }
    const day = old.get(row.observedDate) ?? [];
    day.push(row);
    old.set(row.observedDate, day);
  }
  const changed = [...old].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({ date, rows: unique(day),
      fingerprint: archivedFeedFingerprint(day) }))
    .filter(({ date, fingerprint }) => archivedFingerprints.get(date) !== fingerprint);
  const missingDates = [...archivedFingerprints.keys()].filter((date) =>
    date <= boundary && !old.has(date)).sort();
  return { live, changed, missingDates };
}

export function writeArchivedFeedFile(root: string, date: string,
  fingerprint: string, rows: MtgjsonPriceSnapshotInput[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9]{32}$/.test(fingerprint))
    throw new Error("Invalid archived feed date or fingerprint");
  const directory = resolve(root, "pricing", "feed", date);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${fingerprint}.json.gz`);
  const sorted = unique(rows).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const json = Buffer.from(JSON.stringify({ schemaVersion: 1, date, fingerprint,
    rows: sorted }), "utf8");
  if (json.length > 64 * 1024 * 1024)
    throw new Error(`Archived feed date ${date} exceeds the 64 MiB spool budget`);
  const compressed = gzipSync(json, { level: 6 });
  const fileSha256 = createHash("sha256").update(compressed).digest("hex");
  if (existsSync(path)) {
    const presentSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (presentSha256 !== fileSha256)
      throw new Error(`Archived feed spool conflict for ${date}`);
  } else writeFileSync(path, compressed, { flag: "wx" });
  return { path, fileSha256, rows: sorted.length };
}
