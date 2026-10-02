import type { AcquisitionCardReview } from "./acquisition-review";
const active = (status?: string) => ["WAITING", "PENDING", "RUNNING"].includes(status ?? "");

export function acquisitionReviewProgress(record: AcquisitionCardReview, hasPrinting: boolean) {
  const result = (label: string, problem: string | null = null) => ({ label, problem });
  if (record.review) return result("Review saved");
  if (record.catalog?.status === "PROVIDER_ERROR")
    return result("Catalog unavailable", "The catalog check is unavailable and will retry automatically. You can also find a printing already in this installation.");
  if (record.recognitionStatus === "FAILED")
    return result("Card identification failed", "Automatic identification could not finish. Choose a printing manually from your saved scan.");
  if (record.visualStatus === "FAILED")
    return result("Image comparison failed", "Image comparison failed. You can review any text suggestions or find a printing manually.");
  if (record.printingStatus === "FAILED")
    return result("Printing check failed", "Printing verification failed. Compare the exact printing and stamp with your scan, then save your choice.");
  if (record.printingStatus === "RUNNING") return result("Checking printing…");
  if (record.printingStatus === "PENDING") return result("Printing check queued");
  if (record.catalog?.status === "CHECKING") return result("Checking catalog…");
  if (record.visualStatus === "RUNNING") return result("Comparing card image…");
  if (active(record.visualStatus)) return result("Image comparison queued");
  if (record.recognitionStatus === "RUNNING") return result("Identifying card…");
  if (active(record.recognitionStatus)) return result("Queued for identification");
  if (hasPrinting) return result("Verify this printing");
  if (["NO_MATCH", "COMPLETE"].includes(record.recognitionStatus) || record.catalog?.status === "NOT_FOUND")
    return result("No printing found", "No printing was found for this scan. Search by card name, set or collector number to choose it manually.");
  return result("Choose a printing", "Choose a printing manually from your saved scan.");
}
