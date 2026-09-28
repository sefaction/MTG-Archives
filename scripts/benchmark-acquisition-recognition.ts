import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createAcquisitionRecognitionIndex,
  proposeAcquisitionPrintings,
  type RecognitionCard,
  type RecognitionText,
} from "../lib/acquisition-recognition";

const args = process.argv.slice(2);
function argument(name: string) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`Required ${name}`);
  return args[i + 1];
}
const manifestSchema = z.object({
  catalogCompressedSha256: z.string(),
  entries: z
    .array(
      z.object({
        file: z.string(),
        sha256: z.string(),
        scryfallId: z.string(),
        name: z.string(),
      }),
    )
    .min(1),
});
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  set: z.string(),
  collector_number: z.string(),
  printed_name: z.string().optional(),
  lang: z.string().optional(),
  digital: z.boolean().optional(),
  card_faces: z
    .array(
      z.object({
        name: z.string().optional(),
        printed_name: z.string().optional(),
      }),
    )
    .optional(),
});
async function main() {
  const catalogPath = argument("--catalog");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(argument("--manifest"), "utf8")),
  );
  const report = JSON.parse(await readFile(argument("--ocr"), "utf8"));
  const hash = createHash("sha256");
  for await (const part of createReadStream(catalogPath)) hash.update(part);
  const catalogDigest = hash.digest("hex");
  if (catalogDigest !== manifest.catalogCompressedSha256)
    throw new Error("Catalog version differs from manifest");
  const cards: RecognitionCard[] = [];
  const lines = createInterface({
    input: createReadStream(catalogPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.length > 1024 * 1024) throw new Error("Catalog record too large");
    if (!line.trim()) continue;
    const c = cardSchema.parse(JSON.parse(line));
    cards.push({
      id: c.id,
      name: c.name,
      printedName: c.printed_name,
      faceNames: c.card_faces?.flatMap((f) => [
        f.name ?? "",
        f.printed_name ?? "",
      ]),
      setCode: c.set,
      collectorNumber: c.collector_number,
      lang: c.lang,
      digital: c.digital,
    });
  }
  const index = createAcquisitionRecognitionIndex(cards);
  const results = [];
  for (const expected of manifest.entries) {
    const matching = report.results.filter(
      (r: any) => r.file === expected.file,
    );
    if (matching.length !== 1 || matching[0].sha256 !== expected.sha256)
      throw new Error(
        `Missing, duplicate or changed private sample: ${expected.file}`,
      );
    const observed = matching[0];
    let text: RecognitionText;
    if (observed.text) {
      // Production native output may group geometrically adjacent OCR words.
      // Evaluate exactly that contract instead of reconstructing different text.
      text = z
        .object({
          title: z.array(z.string().max(2000)).max(100),
          footer: z.array(z.string().max(2000)).max(100),
        })
        .parse(observed.text);
    } else if (observed.lines) {
      text = {
        title: observed.lines
          .filter(
            (l: any) => Math.max(...l.polygon.map((p: number[]) => p[1])) < 260,
          )
          .map((l: any) => l.text),
        footer: observed.lines
          .filter(
            (l: any) =>
              Math.min(...l.polygon.map((p: number[]) => p[1])) > 1220,
          )
          .map((l: any) => l.text),
      };
    } else {
      text = {
        title: Object.values(observed.regions?.title ?? {}).flatMap((v) =>
          String(v).split("\n"),
        ),
        footer: Object.values(observed.regions?.footer ?? {}).map(String),
      };
    }
    const start = performance.now();
    const result = proposeAcquisitionPrintings(index, text);
    const ms = performance.now() - start;
    const rank = result.proposals.findIndex(
      (p) => p.card.id === expected.scryfallId,
    );
    results.push({
      file: expected.file,
      expectedScryfallId: expected.scryfallId,
      text,
      milliseconds: Math.round(ms),
      exactPrintingRank: rank < 0 ? null : rank + 1,
      expectedNameProposed: result.proposals.some(
        (p) => p.card.name === expected.name,
      ),
      result,
    });
  }
  const summary = {
    version: 1,
    split: "development-only",
    catalogDigest,
    catalogCards: cards.length,
    paperCards: index.cards,
    samples: results.length,
    exactPrintingRecallAt12: results.filter((r) => r.exactPrintingRank !== null)
      .length,
    exactPrintingRank1: results.filter((r) => r.exactPrintingRank === 1).length,
    expectedNameProposed: results.filter((r) => r.expectedNameProposed).length,
    strongMatchProposals: results.filter((r) => r.result.automaticAcceptance)
      .length,
    incorrectStrongMatchProposals: results.filter(
      (r) => r.result.automaticAcceptance && r.exactPrintingRank !== 1,
    ).length,
    automaticAcceptances: 0, // Offline evaluation never writes saved decisions.
    automaticPrecision: null,
    results,
  };
  await writeFile(argument("--output"), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({
      ...summary,
      results: results.map((r) => ({
        file: r.file,
        exactPrintingRank: r.exactPrintingRank,
        milliseconds: r.milliseconds,
      })),
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
