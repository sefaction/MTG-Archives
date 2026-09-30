import type { ScannerDiscoveryIssue } from "@/lib/scanner-protocol";

export function ScannerDiscoveryNotice({ issues = [] }: { issues?: ScannerDiscoveryIssue[] }) {
  if (!issues.length) return null;
  const restart = issues.some(issue => issue.code === "DISCOVERY_RESTART_REQUIRED");
  return <p role="status" className="text-sm break-words">
    Windows could not check every scanner driver. You can still use any listed source.
    {restart
      ? " If your scanner is missing, check its manufacturer driver. Finish any active scan, then Disconnect this computer’s helper and Connect this computer again to restart detection."
      : " Detection retries automatically. If your scanner is missing, check its USB connection, power and manufacturer driver."}
    {" "}Saved scans are kept.
  </p>;
}
