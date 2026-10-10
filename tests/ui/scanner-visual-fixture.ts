import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Independently validate the mounted, complete generation without querying a photo.
// The isolated descriptor cannot download, publish an index or disturb a warm worker.
export function scannerVisualFixtureDescriptor() {
  const run = (...args: string[]) => execFileSync("docker", args, {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
  });
  const service = JSON.parse(run("inspect", "mtg-archives-acquisition-visual-worker-1",
    "--format", '{"image":{{json .Image}},"mounts":{{json .Mounts}}}'));
  const mounts = ["/visual/models", "/visual/index", "/visual/references"].flatMap(destination => {
    const mount = service.mounts.find((value: any) => value.Destination === destination);
    if (!mount || mount.Type !== "bind" || mount.RW) throw new Error("Read-only visual fixture cache required");
    return ["--mount", `type=bind,src=${mount.Source},dst=${destination},readonly`];
  });
  const name = `mtg-crop-visual-descriptor-${randomUUID()}`;
  try {
    const descriptor = JSON.parse(run("run", "--name", name, "--rm", "--pull", "never", "--network", "none", "--read-only",
      "--memory", "1536m", "--cpus", "1", "--tmpfs", "/tmp:rw,size=64m", "--entrypoint", "python",
      ...mounts, service.image, "/app/tools/acquisition-runtime/visual.py", "--describe"));
    if (descriptor.version !== "visual-cpu-candidates-v1" || !Number.isSafeInteger(descriptor.referenceCount) ||
      descriptor.referenceCount <= 0 || !/^[a-f0-9]{64}$/.test(descriptor.digest) ||
      !/^[a-f0-9]{64}$/.test(descriptor.indexSha256)) throw new Error("Invalid complete visual fixture descriptor");
    return descriptor as { digest: string; indexSha256: string; referenceCount: number };
  } finally {
    // A Docker client timeout must not leave the exact owned descriptor running.
    try { run("rm", "--force", name); } catch (error) {
      if (!String((error as { stderr?: string }).stderr).includes("No such container")) throw error;
    }
  }
}
