import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { acquisitionNativeEnvironment } from "./acquisition-native-environment";
import { nativeAbortReason, nativeFailureError, type NativeFailureObserver, type NativeFailureReason } from "./acquisition-native-failure";

// One private frame at a time. Keep model weights warm, but kill the process
// and settle the active request on close if it exceeds bounds or is cancelled.
export class AcquisitionNativeStream {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    detach: () => void;
    progress?: (value: unknown) => void;
    progressFrames: number;
    bytes: number;
    signal: AbortSignal;
    invalidated: boolean;
  } | null = null;
  private output = Buffer.alloc(0);
  private failureReason: NativeFailureReason | null = null;
  private systemCode: unknown = null;
  constructor(
    private executable: string,
    private args: string[],
    private maxInputBytes = 10 * 1024 * 1024 + 1024,
    private observe?: NativeFailureObserver,
  ) {
    // Image hints and printing envelopes add bounded metadata to the photo
    // limit. Callers cannot relax this into an arbitrary native input stream.
    if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 ||
        maxInputBytes > 10 * 1024 * 1024 + 65536)
      throw new Error("Processing native input bound invalid");
  }
  close() {
    this.stop("SHUTDOWN");
  }
  private stop(reason: NativeFailureReason) {
    this.failureReason ??= reason;
    if (this.pending) this.pending.invalidated = true;
    this.child?.kill("SIGKILL");
  }
  async shutdown() {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      this.close();
    });
  }
  request(input: Buffer, signal: AbortSignal, progress?: (value: unknown) => void): Promise<unknown> {
    if (this.pending)
      return Promise.reject(new Error("Processing native worker busy"));
    if (signal.aborted || !input.length || input.length > this.maxInputBytes)
      return Promise.reject(new Error("Processing native input invalid"));
    if (!this.child) {
      const child = spawn(this.executable, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        ...acquisitionNativeEnvironment(),
      });
      this.child = child;
      this.output = Buffer.alloc(0);
      this.failureReason = null;
      this.systemCode = null;
      child.stdout.on("data", (chunk: Buffer) => {
        if (!this.pending) return this.stop("UNSOLICITED_OUTPUT");
        if (this.pending.invalidated) return this.stop(this.failureReason ?? "PROTOCOL");
        if (this.pending.signal.aborted) return this.stop(nativeAbortReason(this.pending.signal));
        if (this.pending.bytes + chunk.length > 65536) return this.stop("OUTPUT_LIMIT");
        this.pending.bytes += chunk.length;
        this.output = Buffer.concat([this.output, chunk]);
        while (this.pending) {
          if (this.pending.invalidated || this.pending.signal.aborted) return this.stop(nativeAbortReason(this.pending.signal));
          const end = this.output.indexOf(10);
          if (end < 0) return;
          const line = this.output.subarray(0, end);
          this.output = this.output.subarray(end + 1);
          const request = this.pending;
          let value: any;
          try { value = JSON.parse(line.toString("utf8")); }
          catch { return this.stop("INVALID_JSON"); }
          if (value?.progress === true) {
            if (!request.progress || ++request.progressFrames > 4) return this.stop("PROTOCOL");
            try { request.progress(value); }
            catch { return this.stop("PROGRESS_CALLBACK"); }
            continue;
          }
          if (this.output.length) return this.stop("PROTOCOL");
          this.pending = null;
          this.output = Buffer.alloc(0);
          request.detach();
          request.resolve(value);
        }
      });
      child.stderr.on("data", () => {});
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (!this.failureReason) this.systemCode = error.code;
        this.stop("INPUT_PIPE");
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        this.failureReason = "SPAWN";
        this.systemCode = error.code;
        this.stop("SPAWN");
      });
      child.on("close", (code, exitSignal) => {
        const request = this.pending;
        this.pending = null;
        this.child = null;
        this.output = Buffer.alloc(0);
        request?.detach();
        const error = nativeFailureError("Processing native worker stopped", this.failureReason ?? "EXIT",
          code, exitSignal, this.systemCode, this.failureReason === "SHUTDOWN" ? undefined : this.observe);
        request?.reject(error);
      });
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.stop(nativeAbortReason(signal));
      this.pending = {
        resolve,
        reject,
        detach: () => signal.removeEventListener("abort", abort),
        progress,
        progressFrames: 0,
        bytes: 0,
        signal,
        invalidated: false,
      };
      signal.addEventListener("abort", abort, { once: true });
      const header = Buffer.alloc(4);
      header.writeUInt32BE(input.length);
      this.child!.stdin.write(header);
      this.child!.stdin.write(input);
    });
  }
}
