import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { acquisitionNativeEnvironment } from "./acquisition-native-environment";

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
  constructor(
    private executable: string,
    private args: string[],
    private maxInputBytes = 10 * 1024 * 1024 + 1024,
  ) {
    // Image hints and printing envelopes add bounded metadata to the photo
    // limit. Callers cannot relax this into an arbitrary native input stream.
    if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 ||
        maxInputBytes > 10 * 1024 * 1024 + 65536)
      throw new Error("Processing native input bound invalid");
  }
  close() {
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
      child.stdout.on("data", (chunk: Buffer) => {
        if (!this.pending || this.pending.invalidated || this.pending.signal.aborted || this.pending.bytes + chunk.length > 65536)
          return this.close();
        this.pending.bytes += chunk.length;
        this.output = Buffer.concat([this.output, chunk]);
        while (this.pending) {
          if (this.pending.invalidated || this.pending.signal.aborted) return this.close();
          const end = this.output.indexOf(10);
          if (end < 0) return;
          const line = this.output.subarray(0, end);
          this.output = this.output.subarray(end + 1);
          const request = this.pending;
          try {
            const value = JSON.parse(line.toString("utf8"));
            if (value?.progress === true) {
              if (!request.progress || ++request.progressFrames > 4) return this.close();
              request.progress(value);
              continue;
            }
            if (this.output.length) return this.close();
            this.pending = null;
            this.output = Buffer.alloc(0);
            request.detach();
            request.resolve(value);
          } catch {
            return this.close();
          }
        }
      });
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => this.close());
      child.on("error", () => this.close());
      child.on("close", () => {
        const request = this.pending;
        this.pending = null;
        this.child = null;
        this.output = Buffer.alloc(0);
        request?.detach();
        request?.reject(new Error("Processing native worker stopped"));
      });
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.close();
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
