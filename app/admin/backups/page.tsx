export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { requireAdminMode } from "@/lib/auth";
import { createBackup, formatBytes, getBackupDir, listBackups } from "@/lib/backup";

async function createBackupAction() {
  "use server";
  await requireAdminMode();
  await createBackup();
  revalidatePath("/admin/backups");
}

export default async function AdminBackupsPage() {
  await requireAdminMode();
  const backups = await listBackups();
  const backupDir = getBackupDir();

  return (
    <main className="space-y-6 p-8">
      <Nav />

      <section className="space-y-3">
        <div>
          <h1 className="text-3xl font-bold">Backups</h1>
          <p className="text-zinc-400">
            Create and inspect full PostgreSQL backups for this MTG Archives
            instance.
          </p>
        </div>
        <form action={createBackupAction}>
          <SubmitButton pendingLabel="Creating backup..." className="border px-3 py-2">
            Create Backup
          </SubmitButton>
        </form>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Storage</h2>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-zinc-400">Backup directory</dt>
            <dd className="break-all">{backupDir}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Restore command</dt>
            <dd className="break-all">
              npm run backup:restore -- /path/to/backup.tar.gz --force
            </dd>
          </div>
        </dl>
        <p className="text-sm text-zinc-500">
          Restore is intentionally CLI-only. Run it from the app container or a
          backup utility container while the app is in maintenance mode.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent backups</h2>
        {backups.length ? (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="p-3">File</th>
                  <th className="p-3">Created</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Included</th>
                  <th className="p-3">Database</th>
                </tr>
              </thead>
              <tbody>
                {backups.slice(0, 20).map((backup) => (
                  <tr key={backup.path} className="border-t border-zinc-800">
                    <td className="max-w-sm break-all p-3 font-mono text-xs">
                      {backup.filename}
                    </td>
                    <td className="p-3">{backup.createdAt ?? "Unknown"}</td>
                    <td className="p-3">{formatBytes(backup.sizeBytes)}</td>
                    <td className="p-3">
                      {backup.manifest
                        ? `database${
                            backup.manifest.included.appdata ? ", appdata" : ""
                          }`
                        : "Manifest unavailable"}
                    </td>
                    <td className="p-3">
                      {backup.manifest?.database.name ?? "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No backups found.</p>
        )}
      </section>
    </main>
  );
}
