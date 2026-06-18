import { restoreBackup } from "../lib/backup";

const args = process.argv.slice(2);
const backupPath = args.find((arg) => !arg.startsWith("--"));
const force = args.includes("--force");

async function main() {
  if (!backupPath) {
    throw new Error(
      "Usage: npm run backup:restore -- /path/to/backup.tar.gz [--force]",
    );
  }
  const result = await restoreBackup(backupPath, { force });
  if (result.dryRun) {
    console.log(result.message);
    console.log(`Backup created at: ${result.manifest.createdAt}`);
    console.log(`Database dump: ${result.manifest.database.filename}`);
    console.log(
      `Included: database${result.manifest.included.appdata ? ", appdata" : ""}`,
    );
  } else {
    console.log("Restore completed.");
    console.log(`Restored backup created at: ${result.manifest.createdAt}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
