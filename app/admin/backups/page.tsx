export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { requireAdminMode } from "@/lib/auth";
import {
  createBackup,
  deleteBackupByFilename,
  formatBytes,
  getBackupDir,
  getBackupPathForFilename,
  listBackups,
  restoreBackup,
} from "@/lib/backup";

async function createBackupAction() {
  "use server";
  await requireAdminMode();
  await createBackup();
  revalidatePath("/admin/backups");
}

async function restoreBackupAction(formData: FormData) {
  "use server";
  await requireAdminMode();
  const filename = String(formData.get("filename") || "").trim();
  const confirmFilename = String(formData.get("confirmFilename") || "").trim();
  const confirmation = String(formData.get("confirmation") || "").trim();
  if (filename !== confirmFilename) {
    throw new Error("Backup filename confirmation did not match.");
  }
  if (confirmation !== "RESTORE") {
    throw new Error("Type RESTORE to confirm this destructive restore.");
  }
  console.warn("[backup-restore] admin requested web restore", {
    filename,
    requestedAt: new Date().toISOString(),
  });
  await restoreBackup(getBackupPathForFilename(filename), {
    force: true,
    confirmation,
  });
  revalidatePath("/admin/backups");
}

async function deleteBackupAction(formData: FormData) {
  "use server";
  await requireAdminMode();
  const filename = String(formData.get("filename") || "").trim();
  const confirmFilename = String(formData.get("confirmFilename") || "").trim();
  const confirmation = String(formData.get("confirmation") || "").trim();
  if (filename !== confirmFilename) {
    throw new Error("Backup filename confirmation did not match.");
  }
  if (confirmation !== "DELETE") {
    throw new Error("Type DELETE to confirm backup deletion.");
  }
  console.warn("[backup-delete] admin deleted backup", {
    filename,
    requestedAt: new Date().toISOString(),
  });
  await deleteBackupByFilename(filename);
  revalidatePath("/admin/backups");
}

export default async function AdminBackupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminMode();
  const params = await searchParams;
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
          <SubmitButton
            pendingLabel="Creating backup..."
            className="border px-3 py-2"
          >
            Create Backup
          </SubmitButton>
        </form>
      </section>

      {params.uploaded ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-100">
          Backup uploaded and validated.
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">
          {params.error}
        </p>
      ) : null}

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Upload backup</h2>
        <p className="text-sm text-zinc-400">
          Upload a previously created MTG Archives backup archive. The archive
          is validated before it is added to the backup directory.
        </p>
        <form
          action="/api/admin/backups/upload"
          method="post"
          encType="multipart/form-data"
          className="flex flex-wrap gap-3"
        >
          <input
            name="backupFile"
            type="file"
            accept=".tar.gz,application/gzip,application/x-gzip"
            required
            className="max-w-full rounded border border-zinc-700 bg-zinc-900 p-2"
          />
          <SubmitButton
            pendingLabel="Uploading backup..."
            className="border px-3 py-2"
          >
            Upload Backup
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
          Restore replaces the configured database schema and included appdata.
          Prefer maintenance mode or a quiet local instance before restoring.
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
                  <th className="p-3">Download</th>
                  <th className="p-3">Restore</th>
                  <th className="p-3">Delete</th>
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
                    <td className="p-3">
                      {backup.manifest ? (
                        <a
                          className="inline-block border border-zinc-700 px-3 py-2"
                          href={`/api/admin/backups/download/${encodeURIComponent(
                            backup.filename,
                          )}`}
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          Unavailable
                        </span>
                      )}
                    </td>
                    <td className="min-w-80 p-3">
                      {backup.manifest ? (
                        <form action={restoreBackupAction} className="space-y-2">
                          <input
                            type="hidden"
                            name="filename"
                            value={backup.filename}
                          />
                          <p className="text-xs text-red-200">
                            Destructive. Type RESTORE and this exact filename.
                          </p>
                          <input
                            name="confirmation"
                            placeholder="RESTORE"
                            required
                            className="w-full rounded border border-red-800 bg-zinc-950 p-2 text-sm"
                          />
                          <input
                            name="confirmFilename"
                            placeholder={backup.filename}
                            required
                            className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
                          />
                          <SubmitButton
                            pendingLabel="Restoring..."
                            className="border border-red-700 px-3 py-2 text-red-100"
                          >
                            Restore Backup
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          Restore unavailable until manifest can be read.
                        </span>
                      )}
                    </td>
                    <td className="min-w-80 p-3">
                      {backup.manifest ? (
                        <form action={deleteBackupAction} className="space-y-2">
                          <input
                            type="hidden"
                            name="filename"
                            value={backup.filename}
                          />
                          <p className="text-xs text-red-200">
                            Deletes only this backup archive. Type DELETE and
                            this exact filename.
                          </p>
                          <input
                            name="confirmation"
                            placeholder="DELETE"
                            required
                            className="w-full rounded border border-red-800 bg-zinc-950 p-2 text-sm"
                          />
                          <input
                            name="confirmFilename"
                            placeholder={backup.filename}
                            required
                            className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
                          />
                          <SubmitButton
                            pendingLabel="Deleting..."
                            className="border border-red-700 px-3 py-2 text-red-100"
                          >
                            Delete Backup
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          Delete unavailable until manifest can be read.
                        </span>
                      )}
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
