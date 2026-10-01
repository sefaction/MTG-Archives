-- Reuse existing bounded completed observations, without duplicating private
-- evidence. Legacy jobs lack the key and remain conservative cache misses.
CREATE INDEX "AcquisitionProcessingJob_printing_reuse_idx"
ON "AcquisitionProcessingJob" ((output->'printingReuse'->>'key'), "createdAt" DESC, id DESC)
WHERE stage='photo-printing-evidence-v1' AND status='COMPLETE';
