import { createBackup, formatBytes } from "../lib/backup";

async function main() {
  const result = await createBackup();
  console.log(`Backup created: ${result.path}`);
  console.log(`Size: ${formatBytes(result.sizeBytes)}`);
  console.log(`Database: ${result.manifest.database.name}`);
  console.log(
    `Included: database${result.manifest.included.appdata ? ", appdata" : ""}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
