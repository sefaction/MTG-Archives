import {acquisitionRecognitionSelection} from "./acquisition-recognition-jobs";
import type {RecognitionResponse} from "./acquisition-recognition-dto";
import {CATALOG_RECONCILIATION_STAGE} from "./acquisition-catalog-status";
import {PRINTING_STAGE} from "./acquisition-printing";
import type {AcquisitionReviewProblem} from "./acquisition-review-display";
import type {AcquisitionDefaults} from "./acquisition-review";
import {finishForPrinting} from "./acquisition-finish";

/** Compact database projection only; no private pixels, text, model or paths. */
export type AcquisitionProblemJob = {
  id: string;
  stage: string;
  status: RecognitionResponse["status"];
  input: {catalogJobId: string | null};
  output: {sourceCatalogJobId: string | null; referenceAdmission: {status: string | null}};
  resultStatus: string | null;
  proposalCount: number | null;
  proposalIds: (string | null)[] | null;
  catalogStatus: string | null;
  geometryStatus: string | null;
  framing: string | null;
};

export function acquisitionReviewProblems(input: {
  committed: boolean;
  physicalReasons: readonly string[];
  photoReady: boolean;
  review: {cardId: string | null; finish: string} | null;
  defaultsFinish: AcquisitionDefaults["finish"];
  printings: ReadonlyMap<string, {finishes: unknown}>;
  jobs: AcquisitionProblemJob[];
  visualEnabled?: boolean;
  printingEnabled?: boolean;
}): AcquisitionReviewProblem[] {
  if (input.committed || input.physicalReasons.includes("UNAVAILABLE")) return [];
  const result: AcquisitionReviewProblem[] = [];
  if (input.physicalReasons.includes("OVERFLOW")) result.push("overflow");
  if (!input.photoReady) return result;
  const {job, latest, visualStatus, printingStatus} = acquisitionRecognitionSelection(input.jobs,
    input.visualEnabled ?? false, input.printingEnabled ?? false);
  const validResult = job && ["CONFLICT", "REVIEW_REQUIRED", "NO_MATCH", "STRONG_MATCH"].includes(job.resultStatus ?? "") &&
    job.proposalCount !== null && job.proposalCount >= 0 && job.proposalCount <= 12 &&
    Array.isArray(job.proposalIds) && job.proposalIds.length === job.proposalCount && job.proposalIds.every(id => typeof id === "string");
  const proposals = job && validResult ? (job.proposalIds ?? []).flatMap(id => {
    const printing = id ? input.printings.get(id) : null;
    return printing ? [printing] : [];
  }) : [];
  if (input.review ? input.review.finish === "UNKNOWN"
    : finishForPrinting(input.defaultsFinish, proposals[0] ?? null) === null) result.push("unknown-finish");
  if (job?.framing === "CLIPPED" ||
      job?.geometryStatus === "NEEDS_CROP") result.push("quality");
  // A deliberate saved printing resolves suggestion selection. It does not
  // remove photo/count/placement problems or invent a finish decision.
  if (input.review?.cardId || !job || job.status !== "COMPLETE") return result;
  if (validResult && job.resultStatus === "CONFLICT" && proposals.length) result.push("conflict");
  // Retained old suggestions remain useful during supplemental work, but an
  // unfinished/failed check must not be counted as a completed no-match result.
  const unsettled = [latest?.status, visualStatus, printingStatus]
    .some(status => status !== undefined && ["WAITING", "PENDING", "RUNNING", "FAILED"].includes(status));
  // Raw OCR's historical CHECKING placeholder is not a catalogue job.
  const catalogStatus = [CATALOG_RECONCILIATION_STAGE, PRINTING_STAGE].includes(job.stage)
    ? job.catalogStatus : null;
  if (latest?.status === "COMPLETE" && !unsettled && validResult && proposals.length === 0 &&
      !["CHECKING", "PROVIDER_ERROR", "INCOMPLETE"].includes(catalogStatus ?? ""))
    result.push("no-match");
  return result;
}
