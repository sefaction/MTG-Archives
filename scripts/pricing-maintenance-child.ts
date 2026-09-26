import { spawn } from "node:child_process";

export function runPricingMaintenanceChild(
  command: string,
  args: string[],
  limitMs: number,
  heartbeat: () => boolean,
  terminationGraceMs = 5_000,
) {
  return new Promise<{ code: number | null; output: string; error: string }>((resolve) => {
    const child = spawn(command, args,
      { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "", error = "", interrupted = false, renewing = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const signal = (name: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, name); } catch { /* Already exited. */ }
      } else child.kill(name);
    };
    const stop = (reason: string) => {
      if (interrupted) return;
      interrupted = true;
      error += ` ${reason}`;
      signal("SIGTERM");
      forceTimer = setTimeout(() => signal("SIGKILL"), terminationGraceMs);
    };
    const timer = setInterval(() => {
      if (renewing || interrupted) return;
      renewing = true;
      try {
        if (!heartbeat()) stop("Lease heartbeat was lost.");
      } catch (reason) {
        stop(`Lease heartbeat failed: ${String(reason)}`);
      } finally { renewing = false; }
    }, 20_000);
    const timeout = setTimeout(() => stop("Operation timed out."), limitMs);
    child.stdout.on("data", (piece: Buffer) => { output += piece.toString(); });
    child.stderr.on("data", (piece: Buffer) => { error += piece.toString(); });
    child.on("error", (reason) => { error += String(reason); });
    child.on("close", (code) => {
      clearInterval(timer); clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      resolve({ code: interrupted ? -1 : code, output, error });
    });
  });
}
