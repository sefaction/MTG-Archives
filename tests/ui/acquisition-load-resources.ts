import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { observeLoad, parseLoadCounters, type LoadSample } from "../../tools/acquisition-eval/scanner-load-resources";
import { acquisitionLoadRoles, acquisitionLoadMemoryBytes, acquisitionLoadProxyMemoryBytes, type IsolatedAcquisitionLoadTarget } from "../isolated-acquisition-load-target";
import { assertLocalAcquisitionLoadEngine, acquisitionLoadDockerEnvironment } from "../isolated-acquisition-load-target";
const execute = promisify(execFile);

/** Reuse the qualified interval/error/continuity observer with exact isolated
 * IDs. All six application roles remain part of the measured topology. */
export function observeIsolatedAcquisitionLoad(target: IsolatedAcquisitionLoadTarget, output: string, endpoint: string) {
  assertLocalAcquisitionLoadEngine(endpoint);
  const docker = async (args: string[]) => (await execute("docker", ["--host", endpoint, ...args], {
    env: acquisitionLoadDockerEnvironment(process.env),
    windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  })).stdout;
  const sample = async (): Promise<LoadSample> => {
    const targets = [...acquisitionLoadRoles.map(role => ({ role, ...target.containers[role], memory: acquisitionLoadMemoryBytes[role] })),
      ...(target.ingressProxy ? [{ role: "load-ingress-proxy", ...target.ingressProxy, memory: acquisitionLoadProxyMemoryBytes }] : [])];
    const roles = await Promise.all(targets.map(async ({ role, id, image, memory }) => {
      const fields = (await docker(["inspect", id, "--format",
        "{{.Id}} {{.Image}} {{.HostConfig.Memory}} {{.State.Running}} {{.State.OOMKilled}} {{.RestartCount}} {{.State.StartedAt}}",
      ])).trim().split(/\s+/);
      if (fields.length !== 7 || fields[0] !== id || fields[1] !== image)
        throw Error("Isolated resource target changed");
      if (Number(fields[2]) !== memory) throw Error("Declared load memory limit changed");
      const counters = await docker(["exec", id, "sh", "-c",
        "cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.current /sys/fs/cgroup/memory.swap.peak /sys/fs/cgroup/memory.events /sys/fs/cgroup/cpu.stat",
      ]);
      const resources = parseLoadCounters(counters);
      if (resources.limit !== memory) throw Error("Actual load memory limit changed");
      return { role, id, image: fields[1], configuredMemory: Number(fields[2]), running: fields[3] === "true",
        oomKilled: fields[4] === "true", restarts: Number(fields[5]), startedAt: fields[6], resources };
    }));
    return { at: new Date().toISOString(), roles };
  };
  return observeLoad(output, { sample });
}
