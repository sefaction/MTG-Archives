-- One original/model/catalog/reference lineage is independent of candidate
-- revisions and parent refresh IDs. Retired/failed jobs still consume the pass.
-- The worker also serializes admission under the existing session lock.
CREATE UNIQUE INDEX "AcquisitionProcessingJob_reference_lineage_key"
ON "AcquisitionProcessingJob" ((input->>'photoId'), "versionKey")
WHERE stage='photo-reference-refinement-v1';
