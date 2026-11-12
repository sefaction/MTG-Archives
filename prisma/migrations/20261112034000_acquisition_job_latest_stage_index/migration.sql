-- Handoffs exclude superseded stage results using candidate/revision/stage and
-- the (createdAt, id) ordering. The artifact-leading unique index cannot bound
-- that lookup when artifactId is absent. Preserve all existing queue predicates.
CREATE INDEX "AcquisitionProcessingJob_candidate_stage_latest_idx"
ON "AcquisitionProcessingJob" ("candidateId", "candidateRevision", "stage", "createdAt", "id");
