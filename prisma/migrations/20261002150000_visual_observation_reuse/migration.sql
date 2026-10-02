-- Exact owner/image/runtime/input-kind request keys in retained bounded outputs.
-- Legacy jobs lack the envelope and remain conservative misses.
CREATE INDEX "AcquisitionProcessingJob_visual_reuse_idx"
ON "AcquisitionProcessingJob" ((output->'visualReuse'->>'key'), "createdAt" DESC, id DESC)
WHERE stage='photo-visual-retrieval-v1' AND status='COMPLETE';
