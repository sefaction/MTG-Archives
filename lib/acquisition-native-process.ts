import { spawn } from "node:child_process";
import { acquisitionNativeEnvironment } from "./acquisition-native-environment";

// Cancellation settles only after the native child exits. An aborted or
// oversized attempt cannot continue consuming CPU or publish late evidence.
export function runAcquisitionNativeProcess(
  executable: string,
  args: string[],
  input: Buffer,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) return Promise.reject(new Error("Processing aborted"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...acquisitionNativeEnvironment(),
    });
    let output = Buffer.alloc(0),
      failed = false;
    const kill = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (bytes: Buffer) => {
      if (output.length + bytes.length > 65536) kill();
      else output = Buffer.concat([output, bytes]);
    });
    // Drain third-party diagnostics but never persist private native output.
    child.stderr.on("data", () => {});
    child.stdin.on("error", kill);
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      if (failed || signal.aborted || code !== 0)
        return reject(new Error("Processing native attempt failed"));
      try {
        resolve(JSON.parse(output.toString("utf8")));
      } catch {
        reject(new Error("Processing native evidence invalid"));
      }
    });
    child.stdin.end(input);
  });
}
