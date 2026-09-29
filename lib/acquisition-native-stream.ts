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
  } | null = null;
  private output = Buffer.alloc(0);
  constructor(
    private executable: string,
    private args: string[],
    private maxInputBytes = 10 * 1024 * 1024,
  ) {
    // Only the printing envelope adds bounded metadata to the existing photo
    // limit. Callers cannot relax this into an arbitrary native input stream.
    if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 ||
        maxInputBytes > 10 * 1024 * 1024 + 65536)
      throw new Error("Processing native input bound invalid");
  }
  close() {
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
  request(input: Buffer, signal: AbortSignal): Promise<unknown> {
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
        if (!this.pending || this.output.length + chunk.length > 65536)
          return this.close();
        this.output = Buffer.concat([this.output, chunk]);
        const end = this.output.indexOf(10);
        if (end < 0) return;
        if (end !== this.output.length - 1) return this.close();
        try {
          const value = JSON.parse(
            this.output.subarray(0, end).toString("utf8"),
          );
          const request = this.pending;
          this.pending = null;
          this.output = Buffer.alloc(0);
          request.detach();
          request.resolve(value);
        } catch {
          this.close();
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
      };
      signal.addEventListener("abort", abort, { once: true });
      const header = Buffer.alloc(4);
      header.writeUInt32BE(input.length);
      this.child!.stdin.write(header);
      this.child!.stdin.write(input);
    });
  }
}
