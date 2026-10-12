import { z } from "zod";
import { correctionHash } from "./acquisition-correction-policy";
import { acquisitionReferenceRegionSchema, selectAcquisitionReferenceRegion } from "./acquisition-reference-region";
import { printingNativeSchema } from "./acquisition-printing";
import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";

export const REFERENCE_REFINEMENT_STAGE = "photo-reference-refinement-v1";
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().uuid();
const lineage = z.object({
  photoId: id, digest: hash, generation: z.number().int().nonnegative(),
  model: hash, primaryVersion: hash, catalog: hash, referenceModel: hash,
  catalogResolver: z.string().min(1).max(80),
});
export const acquisitionReferenceLineageInputSchema = lineage.extend({
  version: z.literal(1), candidateRevision: z.number().int().nonnegative(),
  lineageKey: hash,
  parents: z.object({
    recognitionJobId: id, recognitionOutputHash: hash,
    catalogJobId: id, catalogOutputHash: hash,
    printingJobId: id, printingOutputHash: hash,
  }).strict(),
  reference: acquisitionReferenceRegionSchema,
}).strict();
export type AcquisitionReferenceLineageInput = z.infer<typeof acquisitionReferenceLineageInputSchema>;
export type ReferenceParent = {
  id: string; stage: string; status: string; runId: string; artifactId: string;
  candidateId: string; candidateRevision: number; versionKey: string;
  input: unknown; output: unknown;
};

// Parent job IDs, revisions, chosen references and inferred coordinates cannot
// create another pass within the same photo/model/catalog/reference lineage.
// DB admission must enforce this key across candidate revisions under the
// session lock; the existing per-revision uniqueness constraint alone is not enough.
export function acquisitionReferenceLineageKey(input: z.infer<typeof lineage>) {
  return correctionHash({ stage: REFERENCE_REFINEMENT_STAGE, ...lineage.parse(input) });
}

const baseInput = z.object({ photoId: id, digest: hash, manualAnalysis: z.unknown().optional(),
  referenceRefinement: z.unknown().optional(), inputKind: z.enum(["PHOTO", "CARD_SCAN"]).optional() });
const sourceIds = z.object({ recognitionJobId: id, resolverVersion: z.string() });
const printingIds = z.object({ catalogJobId: id, model: hash });
const originalOutput = z.object({ photoId: id, native: z.object({
  photoDigest: hash, descriptor: hash, geometry: z.object({
    status: z.literal("PROPOSED"), method: z.literal("declared-card-scan"),
    framing: z.string().optional(), referenceRegion: z.unknown().optional(),
    quad: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4).optional(),
  }),
}), referenceRefinement: z.unknown().optional() });

// This is a shared pure check for future admission and publication. It is not
// a replacement for a DB lease/clock, session lock or newest-parent SQL fence.
export function acquisitionReferenceParentsMatch(
  input: AcquisitionReferenceLineageInput,
  parents: [ReferenceParent, ReferenceParent, ReferenceParent],
  scope: { runId: string; artifactId: string; candidateId: string; candidateRevision: number;
    currentModel: string; currentCatalog: string; currentReferenceModel: string;
    photoId: string; photoDigest: string; currentCatalogResolver: string;
    inputKind: "PHOTO" | "CARD_SCAN";
    latestRecognitionJobId: string; latestCatalogJobId: string; latestPrintingJobId: string;
    photoGeneration: number; slotGeneration: number; photoReady: boolean; photoPurged: boolean;
    ownerActive: boolean; creatorActive: boolean; forcePasswordChange: boolean;
    excluded: boolean; committed: boolean; cancelled: boolean; trashed: boolean; deleted: boolean;
    manualAnalysis: unknown; review: unknown; phase: string },
) {
  const parsed = acquisitionReferenceLineageInputSchema.safeParse(input);
  if (!parsed.success) return false;
  const value = parsed.data, [recognition, catalog, printing] = parents;
  if (!recognition || !catalog || !printing || scope.inputKind !== "CARD_SCAN" ||
      scope.manualAnalysis !== null || scope.review !== null ||
      !scope.photoReady || scope.photoPurged || scope.excluded || scope.committed ||
      !scope.ownerActive || !scope.creatorActive || scope.forcePasswordChange ||
      scope.cancelled || scope.trashed || scope.deleted || ["DRAFT", "CANCELLED"].includes(scope.phase) ||
      scope.photoGeneration !== value.generation || scope.slotGeneration !== value.generation ||
      scope.candidateRevision !== value.candidateRevision ||
      scope.currentModel !== value.model || scope.currentCatalog !== value.catalog ||
      scope.photoId !== value.photoId || scope.photoDigest !== value.digest ||
      scope.currentCatalogResolver !== value.catalogResolver ||
      scope.currentReferenceModel !== value.referenceModel) return false;
  const sourceKeys = [value.parents.recognitionJobId, value.parents.catalogJobId, value.parents.printingJobId];
  const latest = [scope.latestRecognitionJobId, scope.latestCatalogJobId, scope.latestPrintingJobId];
  const stages = ["photo-recognition-v1", CATALOG_RECONCILIATION_STAGE, "photo-printing-evidence-v1"];
  const hashes = [value.parents.recognitionOutputHash, value.parents.catalogOutputHash, value.parents.printingOutputHash];
  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i], source = baseInput.safeParse(parent.input);
    if (parent.id !== sourceKeys[i] || parent.id !== latest[i] || parent.stage !== stages[i] ||
        parent.status !== "COMPLETE" || parent.runId !== scope.runId || parent.artifactId !== scope.artifactId ||
        parent.candidateId !== scope.candidateId || parent.candidateRevision !== value.candidateRevision ||
        !source.success || source.data.photoId !== value.photoId || source.data.digest !== value.digest ||
        source.data.manualAnalysis != null || source.data.referenceRefinement != null ||
        correctionHash(parent.output) !== hashes[i]) return false;
  }
  const observed = originalOutput.safeParse(recognition.output);
  const primaryInput = baseInput.safeParse(recognition.input);
  const catalogInput = sourceIds.safeParse(catalog.input), printingInput = printingIds.safeParse(printing.input);
  if (!observed.success || !primaryInput.success || primaryInput.data.inputKind !== "CARD_SCAN" ||
      observed.data.referenceRefinement != null ||
      observed.data.native.geometry.referenceRegion != null ||
      observed.data.native.geometry.framing === "CLIPPED" ||
      observed.data.photoId !== value.photoId || observed.data.native.photoDigest !== value.digest ||
      observed.data.native.descriptor !== value.model || recognition.versionKey !== value.primaryVersion ||
      !catalogInput.success || catalogInput.data.recognitionJobId !== recognition.id ||
      catalogInput.data.resolverVersion !== value.catalogResolver ||
      !printingInput.success || printingInput.data.catalogJobId !== catalog.id ||
      printingInput.data.model !== value.referenceModel) return false;
  const printingOutput = z.object({ printingNative: printingNativeSchema }).safeParse(printing.output);
  const catalogOutput = z.object({ photoId: id, sourceRecognitionJobId: id,
    versions: z.object({ catalog: hash, resolver: z.string() }) }).safeParse(catalog.output);
  const referenceOutput = z.object({ photoId: id, sourceCatalogJobId: id,
    versions: z.object({ catalog: hash, resolver: z.string(), printing: hash }) }).safeParse(printing.output);
  if (!printingOutput.success || !catalogOutput.success || !referenceOutput.success ||
      catalogOutput.data.photoId !== value.photoId || catalogOutput.data.sourceRecognitionJobId !== recognition.id ||
      catalogOutput.data.versions.catalog !== value.catalog || catalogOutput.data.versions.resolver !== value.catalogResolver ||
      referenceOutput.data.photoId !== value.photoId || referenceOutput.data.sourceCatalogJobId !== catalog.id ||
      referenceOutput.data.versions.catalog !== value.catalog || referenceOutput.data.versions.resolver !== value.catalogResolver ||
      referenceOutput.data.versions.printing !== value.referenceModel) return false;
  const proposed = selectAcquisitionReferenceRegion({ inputKind: "CARD_SCAN",
    geometry: observed.data.native.geometry, printing: printingOutput.data.printingNative });
  if (proposed.status !== "PROPOSED" ||
      correctionHash(proposed.region) !== correctionHash(value.reference.region) ||
      correctionHash(proposed.references) !== correctionHash(value.reference.references)) return false;
  return value.lineageKey === acquisitionReferenceLineageKey({
    photoId: value.photoId, digest: value.digest, generation: value.generation,
    model: value.model, primaryVersion: value.primaryVersion, catalog: value.catalog,
    referenceModel: value.referenceModel, catalogResolver: value.catalogResolver,
  });
}
