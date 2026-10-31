type LoadJob = {
  id: string;
  candidateId: string | null;
  stage: string;
  status: string;
  input: unknown;
};

// One candidate can retain both original-frame and reference-refined printing
// evidence. Count cards, while requiring all ordinary work and each descendant.
export function acquisitionLoadProgress(jobs: LoadJob[], requireReferenceAdmission = false) {
  if (jobs.some(job => job.status === 'FAILED')) throw Error('Native fixture job failed');
  const printing = jobs.filter(job => job.stage === 'photo-printing-evidence-v1' && job.status === 'COMPLETE');
  if (printing.some(job => !job.candidateId)) throw Error('Completed printing has no candidate');
  let missingReferencePrinting = 0;
  const references = jobs.filter(job => job.stage === 'photo-reference-refinement-v1');
  const missingReferenceAdmission = requireReferenceAdmission ? printing.filter(job => {
    const input = job.input as {referenceSource?: unknown} | null;
    return input?.referenceSource == null && !references.some(reference => {
      const lineage = reference.input as {parents?: {printingJobId?: unknown}} | null;
      return lineage?.parents?.printingJobId === job.id && reference.candidateId === job.candidateId;
    });
  }).length : 0;
  for (const reference of jobs.filter(job => job.stage === 'photo-reference-refinement-v1' && job.status === 'COMPLETE')) {
    const descendants = printing.filter(job => {
      const input = job.input as {referenceSource?: {referenceJobId?: unknown}} | null;
      return input?.referenceSource?.referenceJobId === reference.id;
    });
    if (descendants.length > 1 || descendants.some(job => job.candidateId !== reference.candidateId))
      throw Error('Reference printing lineage is not one matching candidate');
    if (descendants.length === 0) missingReferencePrinting++;
  }
  const pending = jobs.filter(job => job.status === 'PENDING' || job.status === 'RUNNING').length;
  const completedCandidates = new Set(printing.map(job => job.candidateId)).size;
  return {completedCandidates, printingJobs: printing.length, pending, missingReferencePrinting, missingReferenceAdmission,
    readyCandidates: pending === 0 && missingReferencePrinting === 0 && missingReferenceAdmission === 0 ? completedCandidates : 0};
}
