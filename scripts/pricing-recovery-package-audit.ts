import { readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCopiedPricingRecoveryPackage } from "./pricing-recovery-copy";

const target = process.env.PRICING_RECOVERY_COPY_DIR;
if (!target) throw new Error("PRICING_RECOVERY_COPY_DIR is required");

async function main() {
  const root = await realpath(resolve(target!));
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".package.json"))
    .map((entry) => entry.name).sort();
  let verified = 0;
  const failures: Array<{ package: string; error: string }> = [];
  for (const name of names) {
    try {
      await verifyCopiedPricingRecoveryPackage(root, resolve(root, name));
      verified += 1;
    } catch (error) {
      failures.push({ package: name,
        error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ mode: "pricing-recovery-package-audit",
    checked: names.length, verified, failed: failures.length,
    failures: failures.slice(0, 30) }));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
