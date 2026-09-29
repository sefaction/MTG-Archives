import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createAcquisitionRecognitionIndex,
  proposeAcquisitionPrintings,
  proposeOrientedAcquisitionPrintings,
  type RecognitionCard,
  type RecognitionText,
} from "../lib/acquisition-recognition";
import { combineAcquisitionCandidates } from "../lib/acquisition-visual";

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
  const manifestBytes = await readFile(argument("--manifest"));
  const ocrBytes = await readFile(argument("--ocr"));
  const manifest = manifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const labelsBytes = args.includes("--labels") ? await readFile(argument("--labels")) : null;
  const labels = labelsBytes ? manifestSchema.extend({sourceManifestSha256: z.string()}).parse(
    JSON.parse(labelsBytes.toString("utf8"))) : null;
  if (labels && (labels.sourceManifestSha256 !== createHash("sha256").update(manifestBytes).digest("hex") ||
      labels.catalogCompressedSha256 !== manifest.catalogCompressedSha256 ||
      labels.entries.length !== manifest.entries.length || labels.entries.some((row,i)=>
        row.file !== manifest.entries[i].file || row.sha256 !== manifest.entries[i].sha256)))
    throw new Error("Revised labels must bind to the unchanged original samples and manifest");
  const report = JSON.parse(ocrBytes.toString("utf8"));
  const visualBytes = args.includes("--visual")
    ? await readFile(argument("--visual"))
    : null;
  const visual = visualBytes ? JSON.parse(visualBytes.toString("utf8")) : null;
  const visualIndexBytes = visual
    ? await readFile(argument("--visual-index"))
    : null;
  const visualIndex = visualIndexBytes
    ? JSON.parse(visualIndexBytes.toString("utf8"))
    : null;
  const visualMethod = args.includes("--visual-method")
    ? argument("--visual-method")
    : "visual";
  if (
    visual &&
    (visual.version.manifestSha256 !==
      createHash("sha256").update(manifestBytes).digest("hex") ||
      visual.version.indexSha256 !==
        createHash("sha256").update(visualIndexBytes!).digest("hex") ||
      !visual.downloadComplete ||
      !visualIndex.downloadComplete ||
      visual.referenceCount !== visualIndex.referenceCount ||
      !["visual", "visual_then_sift", "visual_and_sift"].includes(visualMethod))
  )
    throw new Error("Visual retrieval provenance or coverage differs");
  const fixture = args.includes("--fixture") ? argument("--fixture") : null;
  const hash = createHash("sha256");
  for await (const part of createReadStream(catalogPath)) hash.update(part);
  const catalogDigest = hash.digest("hex");
  if (catalogDigest !== manifest.catalogCompressedSha256)
    throw new Error("Catalog version differs from manifest");
  if (visual && visualIndex.source.catalogSha256 !== catalogDigest)
    throw new Error("Visual and text catalogs differ");
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
  const byScryfallId = new Map(cards.map((card) => [card.id, card]));
  const results = [];
  for (const expected of labels?.entries ?? manifest.entries) {
    const matching = report.results.filter(
      (r: any) =>
        r.file === expected.file && (!fixture || r.fixture === fixture),
    );
    if (
      matching.length !== 1 ||
      (fixture ? matching[0].sourceSha256 : matching[0].sha256) !==
        expected.sha256
    )
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
    let result = observed.orientations
      ? proposeOrientedAcquisitionPrintings(index, observed.orientations)
      : proposeAcquisitionPrintings(index, text);
    if (visual) {
      if (!Array.isArray(observed.orientations))
        throw new Error(
          "Hybrid replay requires saved native orientation observations",
        );
      const rows = visual.results.filter(
        (row: any) => row.file === expected.file,
      );
      if (rows.length !== 1)
        throw new Error("Missing or duplicate visual observation");
      // Consume only independently retrieved identities. Ground truth does
      // not choose visual references or alter either method's candidate order.
      const candidatesFor = (method: string) =>
        z
          .array(z.object({ cardId: z.string().uuid() }))
          .max(12)
          .parse(rows[0].methods[method].top)
          .map((row) => ({ scryfallId: row.cardId }));
      const candidates = candidatesFor(
        visualMethod === "visual_and_sift" ? "visual" : visualMethod,
      );
      result = combineAcquisitionCandidates(
        result as ReturnType<typeof proposeOrientedAcquisitionPrintings>,
        {
          candidates,
          ...(visualMethod === "visual_and_sift"
            ? { geometricCandidates: candidatesFor("visual_then_sift") }
            : {}),
        },
        byScryfallId,
      );
    }
    const ms = performance.now() - start;
    const rank = result.proposals.findIndex(
      (p) => p.card.id === expected.scryfallId,
    );
    results.push({
      file: expected.file,
      sha256: expected.sha256,
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
    fixture,
    split: "development-only",
    catalogDigest,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    ...(labelsBytes ? {labelsSha256: createHash("sha256").update(labelsBytes).digest("hex"),
      labelRevision: "post-retrieval-visible-corner-audit"} : {}),
    ocrSha256: createHash("sha256").update(ocrBytes).digest("hex"),
    resolverSha256: createHash("sha256")
      .update(
        await readFile(
          new URL("../lib/acquisition-recognition.ts", import.meta.url),
        ),
      )
      .digest("hex"),
    ...(visualBytes
      ? {
          visualSha256: createHash("sha256").update(visualBytes).digest("hex"),
          visualMethod,
          unionSha256: createHash("sha256")
            .update(
              await readFile(
                new URL("../lib/acquisition-visual.ts", import.meta.url),
              ),
            )
            .digest("hex"),
        }
      : {}),
    catalogCards: cards.length,
    paperCards: index.cards,
    samples: results.length,
    identifiedSamples: results.filter(r=>z.string().uuid().safeParse(r.expectedScryfallId).success).length,
    unresolvedSamples: results.filter(r=>!z.string().uuid().safeParse(r.expectedScryfallId).success).map(r=>r.file),
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
