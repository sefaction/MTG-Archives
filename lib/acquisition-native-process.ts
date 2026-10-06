import { spawn } from "node:child_process";
import { acquisitionNativeEnvironment } from "./acquisition-native-environment";
import { nativeAbortReason, nativeFailureError, type NativeFailureObserver, type NativeFailureReason } from "./acquisition-native-failure";

// Cancellation settles only after the native child exits. An aborted or
// oversized attempt cannot continue consuming CPU or publish late evidence.
export function runAcquisitionNativeProcess(
  executable: string,
  args: string[],
  input: Buffer,
  signal: AbortSignal,
  observe?: NativeFailureObserver,
): Promise<unknown> {
  if (signal.aborted) return Promise.reject(nativeFailureError("Processing aborted", nativeAbortReason(signal), null, null, null, observe));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...acquisitionNativeEnvironment(),
    });
    let output = Buffer.alloc(0),
      failed = false;
    let reason: NativeFailureReason | null = null;
    let systemCode: unknown = null;
    const kill = (failureReason: NativeFailureReason) => {
      failed = true;
      reason ??= failureReason;
      child.kill("SIGKILL");
    };
    const abort = () => kill(nativeAbortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (bytes: Buffer) => {
      if (output.length + bytes.length > 65536) kill("OUTPUT_LIMIT");
      else output = Buffer.concat([output, bytes]);
    });
    // Drain third-party diagnostics but never persist private native output.
    child.stderr.on("data", () => {});
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (!reason) systemCode = error.code;
      kill("INPUT_PIPE");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      failed = true;
      // A failed spawn can also close stdin. Preserve the authoritative spawn
      // event rather than classifying that consequence as an input failure.
      reason = "SPAWN";
      systemCode = error.code;
    });
    child.on("close", (code, exitSignal) => {
      signal.removeEventListener("abort", abort);
      if (failed || signal.aborted || code !== 0)
        return reject(nativeFailureError("Processing native attempt failed", reason ?? (signal.aborted ? nativeAbortReason(signal) : "EXIT"), code, exitSignal, systemCode, observe));
      try {
        resolve(JSON.parse(output.toString("utf8")));
      } catch {
        reject(nativeFailureError("Processing native evidence invalid", "INVALID_JSON", code, exitSignal, null, observe));
      }
    });
    child.stdin.end(input);
  });
}
