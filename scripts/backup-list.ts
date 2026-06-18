import { formatBytes, listBackups } from "../lib/backup";

async function main() {
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log("No backups found.");
  } else {
    for (const backup of backups) {
      const included = backup.manifest
        ? `database${backup.manifest.included.appdata ? ", appdata" : ""}`
        : "manifest unavailable";
      console.log(
        `${backup.filename}\t${backup.createdAt ?? "unknown"}\t${formatBytes(
          backup.sizeBytes,
        )}\t${included}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
