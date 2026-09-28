// Score saved OCR against the same diagnostic pool used by visual_compare.py.
// --resolver is an explicit local module, allowing a pinned historical baseline.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RecognitionCard, RecognitionText } from "../../lib/acquisition-recognition";

function argument(name: string) {
  const position = process.argv.indexOf(name);
  if (position < 0 || !process.argv[position + 1]) throw new Error(`Missing ${name}`);
  return process.argv[position + 1];
}
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

async function main() {
  const resolver = await import(pathToFileURL(path.resolve(argument("--resolver"))).href);
  const references = read(argument("--references"));
  if (references.errors.length) throw new Error("Incomplete reference pool");
  const index = resolver.createAcquisitionRecognitionIndex(references.references);
  const manifest = read(argument("--manifest"));
  const observed = read(argument("--ocr"));
  const results = manifest.entries.map((entry: { file: string; sha256: string; scryfallId: string; name: string }) => {
    const sample = observed.results.find((item: { file: string }) => item.file === entry.file);
    if (!sample || sample.sha256 !== entry.sha256) throw new Error(`Missing or changed sample: ${entry.file}`);
    const text: RecognitionText = sample.text ?? {
      title: Object.values(sample.regions?.title ?? {}).flatMap(value => String(value).split("\n")),
      footer: Object.values(sample.regions?.footer ?? {}).map(String),
    };
    const proposed = resolver.proposeAcquisitionPrintings(index, text);
    const rank = proposed.proposals.findIndex((item: { card: RecognitionCard }) => item.card.id === entry.scryfallId) + 1;
    return {
      file: entry.file,
      exactRank: rank || null,
      nameCorrect: proposed.proposals[0]?.card.name === entry.name,
      automaticAcceptance: proposed.automaticAcceptance,
    };
  });
  const report = {
    scope: references.scope,
    referenceCount: references.references.length,
    photos: results.length,
    exactTop1: results.filter((r: { exactRank: number }) => r.exactRank === 1).length,
    exactTop12: results.filter((r: { exactRank: number | null }) => r.exactRank !== null && r.exactRank <= 12).length,
    nameTop1: results.filter((r: { nameCorrect: boolean }) => r.nameCorrect).length,
    automatic: results.filter((r: { automaticAcceptance: boolean }) => r.automaticAcceptance).length,
    wrongAutomatic: results.filter((r: { automaticAcceptance: boolean; exactRank: number }) => r.automaticAcceptance && r.exactRank !== 1).length,
    results,
  };
  writeFileSync(argument("--output"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, results: undefined }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
