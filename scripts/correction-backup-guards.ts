import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { loadEnvFile } from "../lib/backup";
import { correctionMaintenanceGate } from "../lib/acquisition-correction-worker";
loadEnvFile();
const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2);
  const release = args.find(arg => arg.startsWith("--release="))?.slice("--release=".length);
  if (args.some(arg => arg !== "--confirm-backup-stopped" && !arg.startsWith("--release="))) throw new Error("Use --release=<guard UUID> --confirm-backup-stopped after verifying that backup has stopped");
  if (release) {
    z.string().uuid().parse(release);
    if (!args.includes("--confirm-backup-stopped")) throw new Error("Confirm that the interrupted backup is no longer running with --confirm-backup-stopped");
    const changed = await db.$transaction(async tx => {
      await correctionMaintenanceGate(tx);
      return tx.correctionBackupGuard.updateMany({ where: { id: release, releasedAt: null }, data: { releasedAt: new Date() } });
    });
    console.log(JSON.stringify({ released: changed.count }));
  }
  console.log(JSON.stringify({ activeBackupGuards: await db.correctionBackupGuard.findMany({ where: { releasedAt: null }, select: { id: true, createdAt: true } }) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
