import {createHash} from "node:crypto";
import {z} from "zod";
import {printingNativeSchema} from "../lib/acquisition-printing";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.string().min(1).max(200).refine(v=>!/[\\/]/.test(v) && v !== "." && v !== "..");
const identity = z.string().uuid();
export const runtimeTruthSchema = z.object({
  scope: z.string(),
  catalogCompressedSha256: digest,
  inputKind: z.enum(["PHOTO", "CARD_SCAN"]),
  entries: z.array(z.discriminatedUnion("category", [
    z.object({category: z.literal("PLAYABLE"), file, sha256: digest,
      scryfallId: identity, stamp: z.enum(["PRESENT", "ABSENT"])}),
    z.object({category: z.literal("ART_CARD"), file, sha256: digest}),
  ])).min(1).max(150000),
});
export const runtimeProvenanceSchema = z.object({
  labelHash: digest,
  nativeVersions: z.object({ocr: digest, visual: digest, printing: digest}),
});
const native = z.object({descriptor: digest, photoDigest: digest,
  milliseconds: z.number().finite().nonnegative(),
  geometry: z.object({method: z.string().optional()})});
const resultSchema = z.object({
  file, sha256: digest,
  native,
  image: native.extend({referenceCount: z.number().int().positive(),
    unavailableCount: z.number().int().nonnegative()}),
  output: z.object({
    printingNative: printingNativeSchema.and(z.object({descriptor: digest, photoDigest: digest,
      milliseconds: z.number().finite().nonnegative()})),
    proposals: z.object({automaticAcceptance: z.boolean(),
      proposals: z.array(z.object({card: z.object({id: z.string().min(1)})})).max(12)}),
  }),
  proposedCards: z.array(z.object({id: z.string().min(1), scryfallId: identity})).max(12),
});
type ScoreRow = {
  file: string; sha256: string; expectedScryfallId: string; rank: number | null;
  expectedStamp: "PRESENT" | "ABSENT"; observedStamp: "PRESENT" | "ABSENT" | "UNREADABLE";
  conflictingObservations: boolean; proposalAutomaticAcceptance: boolean;
  referenceCount: number; unavailableCount: number;
  milliseconds: {ocr: number; visual: number; printing: number}; sourceResultSha256: string;
};

// Score saved runtime results, without replaying recognition or using labels to
// select references/candidates. Input images, paths, owner/job IDs and raw OCR
// stay private. This has no database, network or application mutation authority.
export function scoreAcquisitionRuntime(
  manifestBytes: Buffer,
  provenance: unknown,
  records: Map<string, Buffer>,
  allowPartial = false,
) {
  const truth = runtimeTruthSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const source = runtimeProvenanceSchema.parse(provenance);
  const sha256 = (bytes: Buffer)=>createHash("sha256").update(bytes).digest("hex");
  if (sha256(manifestBytes) !== source.labelHash) throw new Error("Frozen visible labels changed");
  if (new Set(truth.entries.map(e=>e.file)).size !== truth.entries.length ||
      new Set(truth.entries.map(e=>e.sha256)).size !== truth.entries.length)
    throw new Error("Duplicate sample file or bytes; group dependent samples before scoring");
  const playable = truth.entries.filter(e=>e.category === "PLAYABLE");
  if (!playable.length) throw new Error("No playable samples");
  const results: ScoreRow[] = [], pending: string[] = [];
  for (const expected of playable) {
    const bytes = records.get(expected.file);
    if (!bytes) { pending.push(expected.file); continue; }
    const observed = resultSchema.parse(JSON.parse(bytes.toString("utf8")));
    const printing = observed.output.printingNative;
    if (observed.file !== expected.file || observed.sha256 !== expected.sha256 ||
        [observed.native, observed.image, printing].some(n=>n.photoDigest !== expected.sha256))
      throw new Error("Runtime result is for a different photo");
    if (observed.native.descriptor !== source.nativeVersions.ocr ||
        observed.image.descriptor !== source.nativeVersions.visual ||
        printing.descriptor !== source.nativeVersions.printing)
      throw new Error("Native generation differs from frozen evaluation");
    if (truth.inputKind === "CARD_SCAN" && [observed.native, observed.image]
      .some(n=>!["declared-card-scan", "scanner-background-trim"].includes(n.geometry.method)))
      throw new Error("Declared scan did not use conservative card preparation");
    const proposals = observed.output.proposals.proposals;
    const cards = observed.proposedCards;
    if (proposals.length !== cards.length || proposals.some((p,i)=>p.card.id !== cards[i].id) ||
        new Set(cards.map(c=>c.id)).size !== cards.length ||
        new Set(cards.map(c=>c.scryfallId)).size !== cards.length ||
        printing.candidates.some(c=>!cards.some(p=>p.scryfallId === c.scryfallId)))
      throw new Error("Printing/result identity mapping differs");
    const position = cards.findIndex(c=>c.scryfallId === expected.scryfallId);
    results.push({file: expected.file, sha256: expected.sha256,
      expectedScryfallId: expected.scryfallId, rank: position < 0 ? null : position+1,
      expectedStamp: expected.stamp, observedStamp: printing.observedStamp,
      conflictingObservations: printing.conflictingObservations,
      proposalAutomaticAcceptance: observed.output.proposals.automaticAcceptance,
      referenceCount: observed.image.referenceCount,
      unavailableCount: observed.image.unavailableCount,
      milliseconds: {ocr: observed.native.milliseconds, visual: observed.image.milliseconds,
        printing: printing.milliseconds}, sourceResultSha256: sha256(bytes)});
  }
  if (pending.length && !allowPartial) throw new Error(`Evaluation incomplete: ${pending.length} playable results pending`);
  const coverage = new Set(results.map(r=>`${r.referenceCount}:${r.unavailableCount}`));
  if (coverage.size > 1) throw new Error("Reference coverage changed during evaluation");
  const stamps = Object.fromEntries(["PRESENT", "ABSENT"].map(state=>{
    const rows = results.filter(r=>r.expectedStamp === state);
    return [state, {labeled: rows.length,
      correct: rows.filter(r=>r.observedStamp === state).length,
      unreadable: rows.filter(r=>r.observedStamp === "UNREADABLE").length,
      wrong: rows.filter(r=>r.observedStamp !== state && r.observedStamp !== "UNREADABLE").map(r=>r.file)}];
  }));
  function timing(stage: "ocr" | "visual" | "printing") {
    const values = results.map(r=>r.milliseconds[stage]).sort((a,b)=>a-b);
    return {samples: values.length,
      mean: values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length) : null,
      median: values.length ? values[Math.floor((values.length-1)/2)] : null,
      p95: values.length ? values[Math.ceil(values.length*.95)-1] : null};
  }
  return {version: 1, complete: !pending.length, scope: truth.scope,
    physicalCopyGrouping: "UNKNOWN", excludedArtCards: truth.entries.length-playable.length,
    provenance: {labelsSha256: source.labelHash, catalogCompressedSha256: truth.catalogCompressedSha256,
      nativeVersions: source.nativeVersions},
    total: playable.length, scored: results.length, pending,
    first: results.filter(r=>r.rank === 1).length, offered: results.filter(r=>r.rank !== null).length,
    proposalAutomaticAcceptances: results.filter(r=>r.proposalAutomaticAcceptance).length,
    stamps, nativeTimingMilliseconds: {ocr: timing("ocr"), visual: timing("visual"), printing: timing("printing")},
    limits: "Native timings exclude queue/provider waits and overlap other local work. Proposal eligibility is not a saved confirmation. Repeated printings and unknown physical grouping are not independent physical trials.",
    results};
}
