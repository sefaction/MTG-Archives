import { execFileSync } from "node:child_process";
import { runVerification } from "../lib/verification";

try {
  if (process.argv.slice(2).some((arg) => arg !== "--core"))
    throw new Error("Only --core is supported");
  const npmCli = process.env.npm_execpath;
  if (!npmCli)
    throw new Error("Run through npm run verify or npm run verify:core");
  runVerification((step) => {
    execFileSync(process.execPath, [npmCli, "run", step], {
      stdio: "inherit",
      windowsHide: true,
    });
  }, process.argv.includes("--core"));
} catch (error: any) {
  console.error("Verification stopped at the failed stage.");
  process.exitCode =
    typeof error.status === "number" && error.status > 0 ? error.status : 1;
}
