import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { PRINTING_STAGE } from "./acquisition-printing";
import { VISUAL_STAGE } from "./acquisition-visual";
import { acquisitionRecognitionDto, type RecognitionResponse } from "./acquisition-recognition-dto";

type EvidenceJob = {id: string; stage: string; status: RecognitionResponse["status"]; output: unknown};
// Callers provide newest-first, owner-authorized jobs for this immutable photo.
// A failed/pending supplemental check retains prior photos and suggestions.
export function acquisitionRecognitionJobs<T extends EvidenceJob>(
  jobs: T[], visualEnabled: boolean, printingEnabled: boolean,
) {
  const visual = jobs.find(j=>j.stage === VISUAL_STAGE);
  const visualStatus = visual?.status ?? (visualEnabled ? "WAITING" : undefined);
  const sources = jobs.filter(j=>j.stage !== VISUAL_STAGE && j.stage !== PRINTING_STAGE);
  const latest = sources[0];
  const completed = sources.find(j=>j.status === "COMPLETE");
  const printing = completed?.stage === CATALOG_RECONCILIATION_STAGE
    ? jobs.find(j=>j.stage === PRINTING_STAGE &&
      (j.output as {sourceCatalogJobId?: string} | null)?.sourceCatalogJobId === completed.id)
    : undefined;
  // Pending jobs store their source identity in input, which is not exposed by
  // the DTO. Find that run's latest printing job through the supplied input.
  const pending = completed?.stage === CATALOG_RECONCILIATION_STAGE
    ? jobs.find(j=>j.stage === PRINTING_STAGE &&
      (j as T & {input?: {catalogJobId?: string}}).input?.catalogJobId === completed.id)
    : undefined;
  const currentPrinting = pending ?? printing;
  const printingStatus = currentPrinting?.status ?? (printingEnabled ? "WAITING" : undefined);
  const job = currentPrinting?.status === "COMPLETE" ? currentPrinting : completed;
  const evidence = acquisitionRecognitionDto(job?.status ?? "WAITING", job?.output, visualStatus, printingStatus);
  if (latest && latest.id !== completed?.id) {
    evidence.status = latest.status;
    evidence.catalog = latest.status === "FAILED"
      ? latest.stage === CATALOG_RECONCILIATION_STAGE
        ? {status: "PROVIDER_ERROR", printingCoverage: "UNRESOLVED"} : null
      : {status: "CHECKING", printingCoverage: "UNRESOLVED"};
    if (evidence.result) {
      evidence.result.automaticAcceptance = false;
      if (evidence.result.status === "STRONG_MATCH") evidence.result.status = "REVIEW_REQUIRED";
    }
  }
  return {job, evidence, visualStatus, printingStatus};
}
