import { cleanupCorrectionFixture } from "./correction-fixture";

type ProgressCleanup = {
  owners: readonly string[];
  page: { isClosed(): boolean; unrouteAll(options: { behavior: "wait" }): Promise<void> };
  release?: () => void;
  database(body: string): unknown;
  primaryFailed: boolean;
  primaryError?: unknown;
};

// Only these locally created progress fixtures are eligible for this teardown.
// Each operation/owner is independent; a failed deletion is reported, not hidden.
export async function cleanupCorrectionProgressFixture(options: ProgressCleanup) {
  const { owners, page, release, database, primaryFailed, primaryError } = options;
  const failures: unknown[] = primaryFailed ? [primaryError] : [];
  const attempt = async (action: () => unknown | Promise<unknown>) => {
    try { await action(); } catch (error) { failures.push(error); }
  };
  const retire = (owner: string, body: string) => {
    if (!/^ui-library-progress-[a-f0-9-]{36}$/.test(owner)) throw Error("Invalid progress fixture");
    return database("const n=" + JSON.stringify(owner) + ";" + body);
  };
  await attempt(() => release?.());
  // Fence all test users before draining their intercepted browser requests.
  for (const owner of owners) await attempt(() => retire(owner, "await p.authSession.deleteMany({where:{userId:n}});return true;"));
  await attempt(async () => { if (!page.isClosed()) await page.unrouteAll({ behavior: "wait" }); });
  for (const owner of owners) {
    await attempt(() => retire(owner, cleanupCorrectionFixture + "return true;"));
    await attempt(() => retire(owner, "await p.user.deleteMany({where:{id:n}});return true;"));
    await attempt(() => retire(owner, "await p.player.deleteMany({where:{id:n}});return true;"));
  }
  if (failures.length) throw new AggregateError(failures, "Correction progress workflow or cleanup failed");
}

