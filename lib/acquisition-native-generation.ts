import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AcquisitionNativeStream } from "./acquisition-native-stream";

type Descriptor = { digest: string };
type Native = Pick<AcquisitionNativeStream, "request" | "shutdown">;

// Only called between jobs. A bad/partial publication leaves the last verified
// process available. Completed results and human decisions are never mutated.
export class AcquisitionNativeGeneration<T extends Descriptor> {
  current: { descriptor: T; native: Native } | null = null;
  private fingerprint: string | null = null;
  private nextCheck = 0;
  constructor(
    private describe: () => Promise<T>,
    private createNative: (descriptor: T) => Native,
    private observe: (event: "ready" | "unavailable", descriptor?: T) => void,
    private readFingerprint = async () => createHash("sha256")
      .update(await readFile("/visual/index/index.json")).digest("hex"),
    private now = () => Date.now(),
  ) {}

  async refresh(force = false) {
    if (!force && this.now() < this.nextCheck) return false;
    this.nextCheck = this.now() + 30000;
    try {
      const fingerprint = await this.readFingerprint();
      if (this.current && fingerprint === this.fingerprint) return false;
      const descriptor = await this.describe();
      // An atomic publisher may have switched again while validation ran.
      if (fingerprint !== await this.readFingerprint())
        throw new Error("Native generation changed during validation");
      const native = this.createNative(descriptor);
      // Wait for old models/caches to leave memory before opening another one.
      await this.current?.native.shutdown();
      this.current = { descriptor, native };
      this.fingerprint = fingerprint;
      this.observe("ready", descriptor);
      return true;
    } catch {
      this.observe("unavailable");
      return false;
    }
  }

  async shutdown() { await this.current?.native.shutdown(); }
}
