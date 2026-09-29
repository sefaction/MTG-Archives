import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {runtimeTruthSchema, scoreAcquisitionRuntime} from "./acquisition-runtime-score";

const args = process.argv.slice(2);
function argument(name: string) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i+1] || args[i+1].startsWith("--")) throw new Error(`Required ${name}`);
  return args[i+1];
}
async function main() {
  const manifestBytes = await readFile(argument("--manifest"));
  const truth = runtimeTruthSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const provenance = JSON.parse(await readFile(argument("--provenance"), "utf8"));
  const directory = path.resolve(argument("--results"));
  const records = new Map<string, Buffer>();
  for (const sample of truth.entries.filter(e=>e.category === "PLAYABLE")) {
    const filename = path.resolve(directory, sample.file+".json");
    if (path.dirname(filename) !== directory) throw new Error("Result outside requested directory");
    try { records.set(sample.file, await readFile(filename)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const report = scoreAcquisitionRuntime(manifestBytes, provenance, records, args.includes("--allow-partial"));
  await writeFile(argument("--output"), JSON.stringify(report, null, 2)+"\n");
  console.log(JSON.stringify({...report, results: undefined, pending: report.pending.length}));
}
main().catch(error=>{console.error((error as Error).message); process.exitCode = 1;});
