-- Bound source-job matching before reading accumulated catalog output evidence.
-- All selector predicates, resolver windows and handoff authority are unchanged.
CREATE INDEX "AcquisitionProcessingJob_source_reference_idx"
ON "AcquisitionProcessingJob" (stage, (input->>'recognitionJobId'), (input->>'resolverVersion'));

-- Expression statistics are needed immediately, before the next worker tick.
ANALYZE "AcquisitionProcessingJob";
