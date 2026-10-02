/** Local recovery maintenance window; callers must validate Docker identities first. */
export type DrillService = {
  id: string;
  service: string;
  running: boolean;
  paused: boolean;
};

export async function withQuiescentDrill<T>(
  services: DrillService[],
  command: (
    action: "stop" | "start" | "pause" | "unpause",
    service: DrillService,
  ) => void,
  journal: (state: object) => void,
  capture: () => Promise<T>,
): Promise<T> {
  const web = services.find((entry) => entry.service === "web");
  if (!web?.running || services.some((entry) => entry.paused))
    throw new Error("Capture requires running web and no pre-paused services");
  const intended: DrillService[] = [];
  let pauseIntended = false;
  let failure: unknown;
  let result: T | undefined;
  journal({ phase: "validated", services });
  try {
    for (const worker of services.filter(
      (entry) => entry !== web && entry.running,
    )) {
      intended.push(worker);
      journal({ phase: "stopping", services, intended, pauseIntended });
      command("stop", worker);
    }
    pauseIntended = true;
    journal({ phase: "pausing", services, intended, pauseIntended });
    command("pause", web);
    result = await capture();
  } catch (error) {
    failure = error;
  } finally {
    const restorationFailures: string[] = [];
    if (pauseIntended) {
      try {
        command("unpause", web);
      } catch {
        restorationFailures.push("web");
      }
    }
    for (const worker of intended) {
      try {
        command("start", worker);
      } catch {
        restorationFailures.push(worker.service);
      }
    }
    journal({
      phase: restorationFailures.length ? "restoration-incomplete" : "restored",
      services,
      restorationFailures,
    });
    if (restorationFailures.length)
      throw new Error(
        `Recovery service restoration failed: ${restorationFailures.join(", ")}`,
      );
  }
  if (failure) throw failure;
  return result as T;
}

/** Failure projection: no row contents or fingerprints are emitted. */
export function changedDrillTables(
  before: Record<string, { rows: number; digest: string }>,
  after: Record<string, { rows: number; digest: string }>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(
      (table) =>
        before[table]?.rows !== after[table]?.rows ||
        before[table]?.digest !== after[table]?.digest,
    )
    .map((table) => ({
      table,
      beforeRows: before[table]?.rows ?? null,
      afterRows: after[table]?.rows ?? null,
      contentChanged: before[table]?.digest !== after[table]?.digest,
    }));
}
