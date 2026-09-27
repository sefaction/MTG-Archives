-- Phone batches follow destination capacity; unknown capacity is open-ended.
ALTER TABLE "AcquisitionCaptureSlot" DROP CONSTRAINT "AcquisitionCaptureSlot_position_check";
ALTER TABLE "AcquisitionCaptureSlot" ADD CONSTRAINT "AcquisitionCaptureSlot_position_check" CHECK ("position" >= 0);
